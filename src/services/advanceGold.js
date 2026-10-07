import { db } from '../store/db.js';
import { ApiError } from '../utils/ApiError.js';
import { rateForPurity } from './rates.js';
import { createPayment, onPaid } from './payments.js';
import { recordTxn } from './transactions.js';
import { round3, addDays, nowIso } from '../utils/money.js';
import { refNo } from '../utils/ids.js';

const cfg = () => db.settings().advanceGold;

export function quote({ amount }) {
  const c = cfg();
  if (!(amount >= c.minAmount)) throw ApiError.badRequest(`Minimum deposit is ₹${c.minAmount}`);
  const purity = c.purity === 'gold24k' ? '24K' : '22K';
  const rate = rateForPurity(purity);
  return { amount, purity, rate, grams: round3(amount / rate), validityDays: c.validityDays, expiresAt: addDays(new Date(), c.validityDays).toISOString(), billingDiscountPct: c.billingDiscountPct };
}

export function list(userId) {
  return db.find('advances', (a) => a.userId === userId).map(refresh).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export function get(userId, id) {
  const a = db.findById('advances', id);
  if (!a || a.userId !== userId) throw ApiError.notFound('Advance not found');
  return refresh(a);
}
function refresh(a) {
  if (a.status === 'ACTIVE' && a.expiresAt < nowIso()) return db.update('advances', a.id, { status: 'EXPIRED' });
  return { ...a, daysLeft: a.expiresAt ? Math.max(0, Math.ceil((new Date(a.expiresAt) - Date.now()) / 86400000)) : null };
}
export function summary(userId) {
  const active = list(userId).filter((a) => a.status === 'ACTIVE');
  return { availableBalance: active.reduce((s, a) => s + a.amount, 0), grams: round3(active.reduce((s, a) => s + a.grams, 0)), activeContracts: active.length, purity: cfg().purity === 'gold24k' ? '24K' : '22K' };
}

export function create(user, { amount, method }) {
  const q = quote({ amount });
  const adv = db.insert('advances', { userId: user.id, contractNo: `AG-${new Date().getFullYear()}-${String(db.count('advances') + 1).padStart(3, '0')}`, amount, rate: q.rate, purity: q.purity, grams: q.grams, method: method || null, depositedAt: null, validityDays: q.validityDays, expiresAt: null, billingDiscountPct: q.billingDiscountPct, status: 'PENDING_PAYMENT', qrPass: null, paymentId: null });
  const payment = createPayment({ userId: user.id, amount, purpose: 'ADVANCE_GOLD', ref: { model: 'advances', id: adv.id }, description: `Advance Gold deposit ₹${amount}`, meta: { advanceId: adv.id } });
  db.update('advances', adv.id, { paymentId: payment.id });
  return { quote: q, advance: adv, payment };
}

onPaid('ADVANCE_GOLD', (payment) => {
  const a = db.findById('advances', payment.meta.advanceId);
  const rate = rateForPurity(a.purity); // convert at the live rate at payment time
  const depositedAt = nowIso();
  const user = db.findById('users', a.userId);
  const adv = db.update('advances', a.id, { status: 'ACTIVE', rate, grams: round3(a.amount / rate), method: payment.method, depositedAt, expiresAt: addDays(depositedAt, a.validityDays).toISOString(), qrPass: `KJ-ADV-${a.contractNo.replace(/-/g, '')}-${(user?.mobile || '').slice(-4)}` });
  const txn = recordTxn({ userId: payment.userId, type: 'ADVANCE_GOLD_DEPOSIT', title: 'Advance Gold deposit', amount: a.amount, grams: adv.grams, rate, purity: a.purity, status: 'CREDITED', method: payment.method, paymentId: payment.id, refModel: 'advances', refId: a.id, meta: { validityDays: a.validityDays } });
  db.insert('notifications', { userId: payment.userId, type: 'ADVANCE', title: 'Advance credited', body: `₹${a.amount.toLocaleString('en-IN')} converted to ${adv.grams} gm ${a.purity} at ₹${rate}/gm. Valid till ${adv.expiresAt.slice(0, 10)}.`, link: '/advance-gold', read: false });
  return { txn, advance: refresh(adv) };
});
onPaid('ADVANCE_GOLD:FAILED', (payment) => { db.update('advances', payment.meta.advanceId, { status: 'PAYMENT_FAILED' }); });

export function redeem(id, { billNo, amountUsed }) {
  const a = db.findById('advances', id);
  if (!a) throw ApiError.notFound('Advance not found');
  if (a.status !== 'ACTIVE') throw ApiError.conflict(`Advance is ${a.status}`);
  return db.update('advances', id, { status: 'REDEEMED', redeemedAt: nowIso(), billNo: billNo || null, amountUsed: amountUsed ?? a.amount });
}
