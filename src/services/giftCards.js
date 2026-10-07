import { db } from '../store/db.js';
import { ApiError } from '../utils/ApiError.js';
import { createPayment, onPaid } from './payments.js';
import { recordTxn } from './transactions.js';
import { addDays, nowIso } from '../utils/money.js';
import { randomCode } from '../utils/ids.js';

const cfg = () => db.settings().giftCards;

export function purchase(user, { amount, recipientName, recipientMobile, message }) {
  const c = cfg();
  if (!(amount >= c.minAmount && amount <= c.maxAmount)) throw ApiError.badRequest(`Amount must be between ₹${c.minAmount} and ₹${c.maxAmount}`);
  const payment = createPayment({ userId: user.id, amount, purpose: 'GIFT_CARD', ref: { model: 'giftCards', id: null }, description: `Gift card ₹${amount} for ${recipientName}`, meta: { amount, recipientName, recipientMobile, message } });
  return { payment };
}
onPaid('GIFT_CARD', (payment) => {
  const m = payment.meta;
  const card = db.insert('giftCards', { code: `KJGC-${randomCode(4)}-${randomCode(4)}-${randomCode(2)}`, amount: m.amount, balance: m.amount, purchasedBy: payment.userId, recipientName: m.recipientName, recipientMobile: m.recipientMobile, message: m.message || '', expiresAt: addDays(new Date(), cfg().validityDays).toISOString(), status: 'ACTIVE', paymentId: payment.id });
  const txn = recordTxn({ userId: payment.userId, type: 'GIFT_CARD', title: `Gift card ₹${m.amount.toLocaleString('en-IN')} for ${m.recipientName}`, amount: m.amount, method: payment.method, paymentId: payment.id, refModel: 'giftCards', refId: card.id });
  return { card, txn };
});
export function mine(userId) { return db.find('giftCards', (g) => g.purchasedBy === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); }
export function check(code) {
  const g = db.findOne('giftCards', (x) => x.code.toUpperCase() === String(code).toUpperCase());
  if (!g) throw ApiError.notFound('Gift card not found');
  const expired = g.expiresAt < nowIso();
  return { code: g.code, amount: g.amount, balance: g.balance, status: expired ? 'EXPIRED' : g.status, expiresAt: g.expiresAt, recipientName: g.recipientName };
}
