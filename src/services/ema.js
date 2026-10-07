import { db } from '../store/db.js';
import { ApiError } from '../utils/ApiError.js';
import { getRaw } from './rates.js';
import { createPayment, onPaid } from './payments.js';
import { recordTxn } from './transactions.js';
import { round3, roundRupee, addMonths, nowIso } from '../utils/money.js';
import { refNo } from '../utils/ids.js';

const cfg = () => db.settings().ema;

export function calculate(monthly) {
  const c = cfg();
  const m = Number(monthly);
  if (!(m >= c.minMonthly && m <= c.maxMonthly)) throw ApiError.badRequest(`Monthly amount must be between ₹${c.minMonthly} and ₹${c.maxMonthly}`);
  if (m % c.step !== 0) throw ApiError.badRequest(`Amount must be in multiples of ₹${c.step}`);
  const youPay = m * c.tenureMonths;
  const bonus = m * c.bonusMonths;
  const approxGrams = round3(youPay / getRaw().gold22k);
  return { monthly: m, tenureMonths: c.tenureMonths, bonusMonths: c.bonusMonths, youPay, bonus, totalValue: youPay + bonus, effectiveBonusPct: Math.round((bonus / youPay) * 10000) / 100, approxGrams22k: approxGrams, makingChargeWaiverPct: c.makingChargeWaiverPct, maturityDate: addMonths(new Date(), c.tenureMonths).toISOString().slice(0, 10) };
}

export function listPlans(userId) {
  return db.find('emaPlans', (p) => p.userId === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(withSummary);
}

export function getPlan(userId, id) {
  const p = db.findById('emaPlans', id);
  if (!p || p.userId !== userId) throw ApiError.notFound('Plan not found');
  return withSummary(p);
}

function withSummary(p) {
  const today = new Date().toISOString().slice(0, 10);
  const installments = p.installments.map((i) => ({ ...i, status: i.status === 'UPCOMING' && i.dueDate <= today ? 'DUE' : i.status, overdue: (i.status === 'DUE' || (i.status === 'UPCOMING' && i.dueDate <= today)) && i.dueDate < today }));
  const next = installments.find((i) => ['DUE', 'UPCOMING'].includes(i.status));
  const upcoming = installments.filter((i) => ['DUE', 'UPCOMING'].includes(i.status));
  const completed = installments.filter((i) => i.status === 'PAID');
  return { ...p, installments, nextInstallment: next || null, upcoming, completed, progressPct: Math.round((p.paidCount / p.tenureMonths) * 100), remainingCount: p.tenureMonths - p.paidCount };
}

export function enrol(user, { monthlyAmount, autopay = false, autopayMethod, branchId }) {
  const c = cfg();
  const calc = calculate(monthlyAmount);
  const start = new Date();
  const installments = [];
  for (let n = 1; n <= c.tenureMonths; n++) installments.push({ n, dueDate: addMonths(start, n - 1).toISOString().slice(0, 10), amount: calc.monthly, status: n === 1 ? 'DUE' : 'UPCOMING' });
  installments.push({ n: c.tenureMonths + 1, dueDate: addMonths(start, c.tenureMonths).toISOString().slice(0, 10), amount: calc.bonus, status: 'BONUS' });
  const plan = db.insert('emaPlans', { userId: user.id, planNo: refNo('EMA-KJ', 4), name: c.title, monthlyAmount: calc.monthly, tenureMonths: c.tenureMonths, bonusMonths: c.bonusMonths, startDate: start.toISOString().slice(0, 10), maturityDate: calc.maturityDate, installments, paidCount: 0, totalPaid: 0, bonusAmount: calc.bonus, goldAccumulatedGrams: 0, autopay: { enabled: !!autopay, method: autopay ? autopayMethod || c.autopayMethods[0] : null }, branchId: branchId || null, status: 'PENDING_FIRST_PAYMENT' });
  const payment = createInstallmentPayment(user.id, plan, 1);
  return { plan: withSummary(plan), payment, calc };
}

function createInstallmentPayment(userId, plan, n) {
  const inst = plan.installments.find((i) => i.n === n);
  return createPayment({ userId, amount: inst.amount, purpose: 'EMA_INSTALLMENT', ref: { model: 'emaPlans', id: plan.id }, description: `${plan.name} ${plan.planNo} instalment ${n} of ${plan.tenureMonths}`, meta: { planId: plan.id, installment: n } });
}

export function payNext(user, planId, { installment } = {}) {
  const plan = db.findById('emaPlans', planId);
  if (!plan || plan.userId !== user.id) throw ApiError.notFound('Plan not found');
  if (!['ACTIVE', 'PENDING_FIRST_PAYMENT'].includes(plan.status)) throw ApiError.conflict(`Plan is ${plan.status}`);
  const target = installment ? plan.installments.find((i) => i.n === installment) : plan.installments.find((i) => ['DUE', 'UPCOMING'].includes(i.status));
  if (!target || !['DUE', 'UPCOMING'].includes(target.status)) throw ApiError.badRequest('No pending instalment');
  const earlierPending = plan.installments.find((i) => i.n < target.n && ['DUE', 'UPCOMING'].includes(i.status));
  if (earlierPending) throw ApiError.badRequest(`Pay instalment ${earlierPending.n} first`);
  return { installment: target, payment: createInstallmentPayment(user.id, plan, target.n) };
}

onPaid('EMA_INSTALLMENT', (payment) => {
  const plan = db.findById('emaPlans', payment.meta.planId);
  const n = payment.meta.installment;
  const rate = getRaw().gold22k;
  const inst = plan.installments.find((i) => i.n === n);
  const grams = round3(inst.amount / rate);
  const txn = recordTxn({ userId: payment.userId, type: 'EMA_INSTALLMENT', title: `${plan.name} instalment ${n} of ${plan.tenureMonths}`, amount: inst.amount, grams, rate, purity: '22K', method: payment.method, paymentId: payment.id, refModel: 'emaPlans', refId: plan.id, meta: { installment: n, planNo: plan.planNo } });
  db.update('emaPlans', plan.id, (p) => {
    const installments = p.installments.map((i) => (i.n === n ? { ...i, status: 'PAID', paidAt: nowIso(), rate, grams, method: payment.method, txnId: txn.id, paymentId: payment.id } : i));
    const paidCount = installments.filter((i) => i.status === 'PAID').length;
    const matured = paidCount >= p.tenureMonths;
    if (matured) installments.forEach((i) => { if (i.status === 'BONUS') { i.status = 'BONUS_CREDITED'; i.paidAt = nowIso(); } });
    return { ...p, installments, paidCount, totalPaid: p.totalPaid + inst.amount, goldAccumulatedGrams: round3(p.goldAccumulatedGrams + grams), status: matured ? 'MATURED' : 'ACTIVE' };
  });
  db.insert('notifications', { userId: payment.userId, type: 'EMA', title: 'Instalment received', body: `₹${inst.amount.toLocaleString('en-IN')} received for ${plan.planNo}. ${grams} gm of 22K gold credited at ₹${rate}/gm.`, link: '/ema', read: false });
  return { txn, plan: getPlan(payment.userId, plan.id) };
});

export function setAutopay(user, planId, { enabled, method, vpa }) {
  const plan = db.findById('emaPlans', planId);
  if (!plan || plan.userId !== user.id) throw ApiError.notFound('Plan not found');
  db.update('emaPlans', planId, { autopay: { enabled, method: enabled ? method || cfg().autopayMethods[0] : null, vpa: enabled ? vpa || null : null } });
  return getPlan(user.id, planId);
}

export function requestRedemption(user, planId, { branchId, note }) {
  const plan = db.findById('emaPlans', planId);
  if (!plan || plan.userId !== user.id) throw ApiError.notFound('Plan not found');
  if (plan.status !== 'MATURED') throw ApiError.conflict('Plan has not matured yet');
  db.update('emaPlans', planId, { status: 'REDEMPTION_REQUESTED', redemption: { branchId, note, requestedAt: nowIso(), voucherNo: refNo('EMAV') } });
  return getPlan(user.id, planId);
}
