/**
 * Mock payment gateway. Mirrors a Razorpay style flow:
 *   1. POST creates a payment (status CREATED) and returns a checkout payload
 *   2. frontend shows a mock checkout UI
 *   3. POST /payments/:id/confirm { outcome: 'success' | 'failure', method }
 *   4. on success the registered fulfilment handler for payment.purpose runs
 * Replace createPayment/confirmPayment with real gateway calls later; the
 * handlers do not change.
 */
import { db } from '../store/db.js';
import { ApiError } from '../utils/ApiError.js';
import { refNo } from '../utils/ids.js';
import { roundRupee } from '../utils/money.js';

const handlers = {};
export function onPaid(purpose, fn) { handlers[purpose] = fn; }

export function createPayment({ userId, amount, purpose, ref, description, meta = {} }) {
  if (!(amount > 0)) throw ApiError.badRequest('Amount must be greater than zero');
  const payment = db.insert('payments', {
    paymentNo: refNo('PAY'),
    userId,
    amount: roundRupee(amount),
    currency: 'INR',
    purpose,
    ref,
    description,
    status: 'CREATED',
    gateway: 'MOCK',
    gatewayOrderId: `order_${refNo('MOCK', 8).replace(/-/g, '')}`,
    method: null,
    paidAt: null,
    meta,
  });
  return payment;
}

export function checkoutPayload(payment) {
  const s = db.settings();
  const user = db.findById('users', payment.userId);
  return {
    paymentId: payment.id,
    paymentNo: payment.paymentNo,
    gateway: 'MOCK',
    key: 'mock_key_demo',
    orderId: payment.gatewayOrderId,
    amount: payment.amount,
    amountPaise: payment.amount * 100,
    currency: 'INR',
    name: s.brand.name,
    description: payment.description,
    image: s.brand.logoUrl,
    prefill: { name: user?.name, contact: user?.mobile, email: user?.email },
    theme: { color: s.theme.primary },
    methods: s.checkout.paymentMethods.filter((m) => m.code !== 'GOLD_WALLET'),
    status: payment.status,
    confirmUrl: `/api/payments/${payment.id}/confirm`,
  };
}

export function confirmPayment(paymentId, { outcome = 'success', method = 'UPI', userId, failureReason }) {
  const payment = db.findById('payments', paymentId);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (userId && payment.userId !== userId) throw ApiError.forbidden('Not your payment');
  if (payment.status === 'PAID') return { payment, result: payment.meta.result ?? null, alreadyPaid: true };
  if (payment.status !== 'CREATED') throw ApiError.conflict(`Payment is ${payment.status}`);

  if (outcome !== 'success') {
    db.update('payments', payment.id, { status: 'FAILED', method, failureReason: failureReason || 'Payment declined by bank (demo)' });
    const handler = handlers[`${payment.purpose}:FAILED`];
    if (handler) handler(payment);
    return { payment, result: null };
  }
  const paidAt = new Date().toISOString();
  db.update('payments', payment.id, { status: 'PAID', method, paidAt, gatewayPaymentId: `pay_${refNo('MOCK', 10).replace(/-/g, '').toLowerCase()}` });
  const handler = handlers[payment.purpose];
  const result = handler ? handler(db.findById('payments', payment.id)) : null;
  db.update('payments', payment.id, (p) => ({ ...p, meta: { ...p.meta, result } }));
  return { payment: db.findById('payments', payment.id), result };
}

export function getPayment(id, userId) {
  const p = db.findById('payments', id);
  if (!p) throw ApiError.notFound('Payment not found');
  if (userId && p.userId !== userId) throw ApiError.forbidden('Not your payment');
  return p;
}
