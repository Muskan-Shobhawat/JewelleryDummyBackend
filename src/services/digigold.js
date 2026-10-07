import { db } from '../store/db.js';
import { ApiError } from '../utils/ApiError.js';
import { getRaw, getRates } from './rates.js';
import { createPayment, onPaid } from './payments.js';
import { recordTxn } from './transactions.js';
import { round2, round3, roundRupee, addMonths, nowIso } from '../utils/money.js';
import { refNo } from '../utils/ids.js';

const cfg = () => db.settings().digiGold;

export function holdingFor(userId) {
  return db.findOne('holdings', (h) => h.userId === userId) || db.insert('holdings', { userId, grams: 0, leasedGrams: 0, investedAmount: 0 });
}

export function portfolio(userId) {
  const h = holdingFor(userId);
  const raw = getRaw();
  const c = cfg();
  const currentValue = roundRupee(h.grams * raw.sellGold24k);
  const buyValue = roundRupee(h.grams * raw.gold24k);
  const pnl = currentValue - h.investedAmount;
  const leases = db.find('leases', (l) => l.userId === userId && l.status === 'ACTIVE');
  return {
    grams: round3(h.grams), leasedGrams: round3(h.leasedGrams || 0), availableGrams: round3(h.grams - (h.leasedGrams || 0)),
    investedAmount: h.investedAmount, currentValue, buyValue, pnl, pnlPct: h.investedAmount ? round2((pnl / h.investedAmount) * 100) : 0,
    buyRate: raw.gold24k, sellRate: raw.sellGold24k, purity: '24K 999.9', vaultPartner: c.vaultPartner, trustee: c.trustee,
    activeLeases: leases.length, updatedAt: getRates().updatedAt,
  };
}

/** Quote for buy (amount or grams) or sell (grams). */
export function quote({ side = 'buy', amount, grams }) {
  const raw = getRaw();
  const c = cfg();
  if (side === 'sell') {
    if (!(grams > 0)) throw ApiError.badRequest('grams is required for sell');
    const rate = raw.sellGold24k;
    const payout = roundRupee(grams * rate);
    return { side, grams: round3(grams), rate, payout, gst: 0, total: payout, note: `Selling benchmark includes ${c.sellSpreadPct}% spread` };
  }
  const rate = raw.gold24k;
  let base, g;
  if (amount > 0) { base = amount / (1 + c.gstPct / 100); g = base / rate; }
  else if (grams > 0) { g = grams; base = grams * rate; }
  else throw ApiError.badRequest('amount or grams is required');
  if (g < c.minGrams || (amount && amount < c.minAmount)) throw ApiError.badRequest(`Minimum purchase is ₹${c.minAmount} or ${c.minGrams} gm`);
  const gst = round2(base * (c.gstPct / 100));
  return { side, grams: round3(g), rate, base: round2(base), gst, gstPct: c.gstPct, total: roundRupee(base + gst) };
}

export function buy(user, { amount, grams }) {
  const q = quote({ side: 'buy', amount, grams });
  const payment = createPayment({ userId: user.id, amount: q.total, purpose: 'DIGI_BUY', ref: { model: 'holdings', id: holdingFor(user.id).id }, description: `Digi Gold ${q.grams} gm @ ₹${q.rate}/gm`, meta: { quote: q } });
  return { quote: q, payment };
}

onPaid('DIGI_BUY', (payment) => {
  const q = payment.meta.quote;
  const h = holdingFor(payment.userId);
  db.update('holdings', h.id, (x) => ({ ...x, grams: round3(x.grams + q.grams), investedAmount: roundRupee(x.investedAmount + q.total) }));
  const txn = recordTxn({ userId: payment.userId, type: 'DIGI_BUY', title: `Digi Gold purchase ${q.grams} gm`, amount: q.total, grams: q.grams, rate: q.rate, purity: '24K', method: payment.method, paymentId: payment.id, refModel: 'holdings', refId: h.id, meta: { base: q.base, gst: q.gst } });
  notify(payment.userId, 'Gold credited', `${q.grams} gm of 24K gold has been added to your vault.`, '/digi-gold');
  return { txn, portfolio: portfolio(payment.userId) };
});

export function sell(user, { grams, sellAll }) {
  const h = holdingFor(user.id);
  const available = round3(h.grams - (h.leasedGrams || 0));
  const g = sellAll ? available : round3(grams);
  if (!(g > 0)) throw ApiError.badRequest('grams must be greater than zero');
  if (g > available + 1e-9) throw ApiError.badRequest(`Only ${available} gm available to sell`);
  if (!user.bank?.verified) throw ApiError.badRequest('Add and verify a bank account before selling');
  const q = quote({ side: 'sell', grams: g });
  db.update('holdings', h.id, (x) => ({ ...x, grams: round3(x.grams - g), investedAmount: Math.max(0, roundRupee(x.investedAmount * (1 - g / x.grams))) }));
  const txn = recordTxn({ userId: user.id, type: 'DIGI_SELL', title: `Digi Gold sold ${g} gm`, amount: q.payout, grams: g, rate: q.rate, purity: '24K', status: 'SUCCESS', method: 'IMPS', refModel: 'holdings', refId: h.id, meta: { payoutTo: user.bank.accountNumberMasked, utr: `UTR${refNo('X', 10).replace(/-/g, '')}` } });
  notify(user.id, 'Payout initiated', `₹${q.payout.toLocaleString('en-IN')} is on its way to ${user.bank.bankName} ${user.bank.accountNumberMasked} via IMPS.`, '/wallet');
  return { quote: q, txn, portfolio: portfolio(user.id) };
}

export function lease(user, { grams, months }) {
  const c = cfg().lease;
  if (!c.enabled) throw ApiError.badRequest('Leasing is not available');
  if (!c.tenureMonths.includes(months)) throw ApiError.badRequest(`Tenure must be one of ${c.tenureMonths.join(', ')} months`);
  const h = holdingFor(user.id);
  const available = round3(h.grams - (h.leasedGrams || 0));
  if (!(grams >= c.minGrams)) throw ApiError.badRequest(`Minimum lease is ${c.minGrams} gm`);
  if (grams > available + 1e-9) throw ApiError.badRequest(`Only ${available} gm available`);
  const yieldGrams = round3(grams * (c.yieldPctPerYear / 100) * (months / 12));
  const l = db.insert('leases', { userId: user.id, leaseNo: refNo('LSE'), grams: round3(grams), months, yieldPctPerYear: c.yieldPctPerYear, yieldGrams, startAt: nowIso(), endAt: addMonths(new Date(), months).toISOString(), status: 'ACTIVE' });
  db.update('holdings', h.id, (x) => ({ ...x, leasedGrams: round3((x.leasedGrams || 0) + grams) }));
  recordTxn({ userId: user.id, type: 'DIGI_LEASE', title: `Leased ${grams} gm for ${months} months`, amount: 0, grams, purity: '24K', status: 'ACTIVE', refModel: 'leases', refId: l.id, meta: { yieldGrams } });
  return { lease: l, portfolio: portfolio(user.id) };
}

export function redeem(user, { type, grams, branchId }) {
  const c = cfg().redeem;
  const h = holdingFor(user.id);
  const available = round3(h.grams - (h.leasedGrams || 0));
  if (!(grams > 0) || grams > available + 1e-9) throw ApiError.badRequest(`Choose between 0.001 and ${available} gm`);
  if (type === 'COIN' && !c.coins.includes(grams)) throw ApiError.badRequest(`Coins available: ${c.coins.join(', ')} gm`);
  const raw = getRaw();
  db.update('holdings', h.id, (x) => ({ ...x, grams: round3(x.grams - grams) }));
  const value = roundRupee(grams * raw.gold24k);
  const voucherNo = refNo(type === 'COIN' ? 'COIN' : 'VCHR');
  const txn = recordTxn({ userId: user.id, type: 'DIGI_REDEEM', title: type === 'COIN' ? `Redeemed ${grams} gm coin` : `Jewellery voucher ${grams} gm`, amount: value, grams, rate: raw.gold24k, purity: '24K', status: type === 'COIN' ? 'PROCESSING' : 'SUCCESS', refModel: 'holdings', refId: h.id, meta: { type, voucherNo, branchId: branchId || null, makingChargeWaiverPct: type === 'VOUCHER' ? c.makingChargeWaiverPct : 0 } });
  return { redemption: { voucherNo, type, grams, value, status: txn.status, deliveryEta: type === 'COIN' ? '5-7 working days' : null }, txn, portfolio: portfolio(user.id) };
}

export function listLeases(userId) { return db.find('leases', (l) => l.userId === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); }

function notify(userId, title, body, link) { db.insert('notifications', { userId, type: 'DIGI_GOLD', title, body, link, read: false }); }
