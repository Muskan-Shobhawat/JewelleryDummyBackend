import { db } from '../store/db.js';
import { ApiError } from '../utils/ApiError.js';
import { rateForPurity } from './rates.js';
import { createPayment, onPaid } from './payments.js';
import { recordTxn } from './transactions.js';
import { roundRupee, addDays, nowIso } from '../utils/money.js';
import { refNo } from '../utils/ids.js';

const cfg = () => db.settings().bookGold;
const PUR = { gold22k: '22K', gold24k: '24K' };

export function quote({ purity = '22K', grams }) {
  const c = cfg();
  const key = Object.keys(PUR).find((k) => PUR[k] === purity);
  if (!key || !c.purities.includes(key)) throw ApiError.badRequest('Purity must be 22K or 24K');
  if (!(grams >= c.minGrams)) throw ApiError.badRequest(`Minimum booking is ${c.minGrams} gm`);
  const rate = rateForPurity(purity);
  const totalValue = roundRupee(grams * rate);
  const advanceAmount = roundRupee(totalValue * (c.advancePct / 100));
  return { purity, grams, rate, totalValue, advancePct: c.advancePct, advanceAmount, balanceDue: totalValue - advanceAmount, validityDays: c.validityDays, expiresAt: addDays(new Date(), c.validityDays).toISOString() };
}

export function list(userId) {
  return db.find('bookings', (b) => b.userId === userId).map(refresh).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export function get(userId, id) {
  const b = db.findById('bookings', id);
  if (!b || b.userId !== userId) throw ApiError.notFound('Booking not found');
  return refresh(b);
}
function refresh(b) {
  if (b.status === 'LOCKED' && b.expiresAt < nowIso()) return db.update('bookings', b.id, { status: 'EXPIRED' });
  const daysLeft = Math.max(0, Math.ceil((new Date(b.expiresAt) - Date.now()) / 86400000));
  return { ...b, daysLeft };
}

export function create(user, { purity, grams, branchId, purpose }) {
  const q = quote({ purity, grams });
  const branch = branchId ? db.findById('branches', branchId) : db.findOne('branches', (x) => x.isFlagship);
  if (!branch) throw ApiError.badRequest('Invalid branch');
  const booking = db.insert('bookings', { userId: user.id, bookingNo: refNo('BMG'), certificateNo: null, purity, grams, lockedRate: q.rate, totalValue: q.totalValue, advancePct: q.advancePct, advanceAmount: q.advanceAmount, balanceDue: q.balanceDue, branchId: branch.id, branchName: branch.name, purpose: purpose || 'Other', bookedAt: null, expiresAt: null, status: 'PENDING_PAYMENT', paymentId: null, txnId: null });
  const payment = createPayment({ userId: user.id, amount: q.advanceAmount, purpose: 'BOOK_GOLD', ref: { model: 'bookings', id: booking.id }, description: `Book My Gold advance: ${grams} gm ${purity} @ ₹${q.rate}/gm`, meta: { bookingId: booking.id } });
  db.update('bookings', booking.id, { paymentId: payment.id });
  return { quote: q, booking, payment };
}

onPaid('BOOK_GOLD', (payment) => {
  const b = db.findById('bookings', payment.meta.bookingId);
  const c = cfg();
  const bookedAt = nowIso();
  const txn = recordTxn({ userId: payment.userId, type: 'BOOK_GOLD_ADVANCE', title: `Book My Gold advance (${b.grams} gm, ${b.purity})`, amount: b.advanceAmount, grams: b.grams, rate: b.lockedRate, purity: b.purity, status: 'RATE_LOCKED', method: payment.method, paymentId: payment.id, refModel: 'bookings', refId: b.id, meta: { validityDays: c.validityDays } });
  const booking = db.update('bookings', b.id, { status: 'LOCKED', bookedAt, expiresAt: addDays(bookedAt, c.validityDays).toISOString(), certificateNo: `RL-${String(new Date().getFullYear()).slice(2)}-${String(db.count('bookings')).padStart(5, '0')}`, txnId: txn.id });
  db.insert('notifications', { userId: payment.userId, type: 'BOOKING', title: 'Rate locked', body: `${b.grams} gm ${b.purity} locked at ₹${b.lockedRate}/gm for ${c.validityDays} days. Certificate ${booking.certificateNo}.`, link: '/book-my-gold', read: false });
  return { txn, booking: refresh(booking) };
});

onPaid('BOOK_GOLD:FAILED', (payment) => { db.update('bookings', payment.meta.bookingId, { status: 'PAYMENT_FAILED' }); });

export function cancel(user, id) {
  const b = get(user.id, id);
  if (b.status !== 'LOCKED') throw ApiError.conflict(`Booking is ${b.status}`);
  db.update('bookings', id, { status: 'CANCELLED', cancelledAt: nowIso() });
  recordTxn({ userId: user.id, type: 'BOOK_GOLD_REFUND', title: `Refund of Book My Gold advance ${b.bookingNo}`, amount: b.advanceAmount, status: 'PROCESSING', method: 'REFUND', refModel: 'bookings', refId: id, meta: { eta: '5-7 working days' } });
  return get(user.id, id);
}

export function redeem(id, { billNo }) {
  const b = db.findById('bookings', id);
  if (!b) throw ApiError.notFound('Booking not found');
  if (b.status !== 'LOCKED') throw ApiError.conflict(`Booking is ${b.status}`);
  return db.update('bookings', id, { status: 'REDEEMED', redeemedAt: nowIso(), billNo: billNo || null });
}
