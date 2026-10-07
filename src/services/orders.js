import { db } from '../store/db.js';
import { ApiError } from '../utils/ApiError.js';
import { priceProduct } from './pricing.js';
import { createPayment, onPaid } from './payments.js';
import { recordTxn } from './transactions.js';
import { holdingFor } from './digigold.js';
import { getRaw } from './rates.js';
import { round2, round3, roundRupee, nowIso } from '../utils/money.js';
import { refNo } from '../utils/ids.js';

const cfg = () => db.settings().checkout;

/** Prices a cart against live rates and applies coupon + shipping. */
export function preview({ items, couponCode, delivery = 'COURIER' }, user) {
  const s = db.settings();
  const c = cfg();
  if (!items?.length) throw ApiError.badRequest('Cart is empty');
  const lines = items.map((it) => {
    const p = db.findById('products', it.productId);
    if (!p || p.active === false) throw ApiError.badRequest(`Product ${it.productId} not available`);
    const price = priceProduct(p);
    if (price.priceOnCall) throw ApiError.badRequest(`${p.name} is price-on-call; please order via WhatsApp`);
    if (!p.inStock) throw ApiError.badRequest(`${p.name} is out of stock`);
    if (it.size && p.sizes?.length && !p.sizes.includes(String(it.size))) throw ApiError.badRequest(`Size ${it.size} not available for ${p.name}`);
    const qty = Math.max(1, Number(it.qty || 1));
    return { productId: p.id, slug: p.slug, name: p.name, image: p.images?.[0], sku: p.sku, qty, size: it.size || null, purity: p.purity, netWeight: p.netWeight, unitPrice: price.total, unitBreakdown: price, lineTotal: price.total * qty };
  });
  const metalValue = round2(lines.reduce((t, l) => t + (l.unitBreakdown.metalValue ?? l.unitBreakdown.subtotal ?? 0) * l.qty, 0));
  const makingCharges = round2(lines.reduce((t, l) => t + (l.unitBreakdown.makingCharge ?? 0) * l.qty, 0));
  const stoneCharges = round2(lines.reduce((t, l) => t + (l.unitBreakdown.stoneCharge ?? 0) * l.qty, 0));
  const subtotal = round2(lines.reduce((t, l) => t + (l.unitBreakdown.subtotal ?? 0) * l.qty, 0));
  let discount = 0; let coupon = null; let couponError = null;
  if (couponCode) {
    coupon = (s.coupons || []).find((x) => x.code.toLowerCase() === String(couponCode).toLowerCase());
    if (!coupon) couponError = 'Invalid coupon code';
    else if (coupon.firstOrderOnly && user && db.count('orders', (o) => o.userId === user.id && o.status !== 'CANCELLED' && o.status !== 'PENDING_PAYMENT') > 0) { couponError = 'Coupon valid on first order only'; coupon = null; }
    else discount = Math.min(round2(subtotal * (coupon.pct / 100)), coupon.maxDiscount || Infinity);
  }
  const taxable = round2(subtotal - discount);
  const gst = round2(taxable * (c.gstPct / 100));
  const shipping = delivery === 'PICKUP' || taxable >= c.freeShippingAbove ? 0 : c.shippingCharge;
  const total = roundRupee(taxable + gst + shipping);
  return { lines, metalValue, makingCharges, stoneCharges, subtotal, discount, couponCode: coupon?.code || null, couponError, gst, gstPct: c.gstPct, shipping, delivery, total, freeShippingAbove: c.freeShippingAbove, rateSnapshot: { gold22k: getRaw().gold22k, gold24k: getRaw().gold24k, at: nowIso() } };
}

export function whatsappOrderLink({ items }, user) {
  const s = db.settings();
  const lines = items.map((it) => {
    const p = db.findById('products', it.productId);
    if (!p) throw ApiError.badRequest(`Product ${it.productId} not available`);
    const price = priceProduct(p);
    return `• ${p.name} (${p.sku}${it.size ? `, size ${it.size}` : ''}) x${it.qty || 1} - ${price.total ? `₹${price.total.toLocaleString('en-IN')}` : 'Price on call'}`;
  });
  const text = `Hello ${s.brand.name}, I would like to order:\n${lines.join('\n')}\n\nName: ${user?.name || ''}\nMobile: ${user?.mobile || ''}\nPlease confirm availability and payment details.`;
  return { text, whatsappUrl: `https://wa.me/${s.contact.whatsappNumber}?text=${encodeURIComponent(text)}` };
}

export function placeOrder(user, body) {
  const c = cfg();
  const pv = preview(body, user);
  if (pv.couponError) throw ApiError.badRequest(pv.couponError);
  if (!c.paymentMethods.some((m) => m.code === body.paymentMethod)) throw ApiError.badRequest('Invalid payment method');
  const branch = body.delivery === 'PICKUP' ? db.findById('branches', body.branchId) : null;
  if (body.delivery === 'PICKUP' && !branch) throw ApiError.badRequest('Select a showroom for pickup');
  const address = body.delivery === 'COURIER' ? body.address || user.address : null;
  if (body.delivery === 'COURIER' && !(address?.line1 && address?.pincode)) throw ApiError.badRequest('Delivery address is required');
  const order = db.insert('orders', { userId: user.id, orderNo: refNo('ORD'), items: pv.lines, subtotal: pv.subtotal, metalValue: pv.metalValue, makingCharges: pv.makingCharges, stoneCharges: pv.stoneCharges, gst: pv.gst, discount: pv.discount, couponCode: pv.couponCode, shipping: pv.shipping, total: pv.total, delivery: body.delivery || 'COURIER', address, branchId: branch?.id || null, branchName: branch?.name || null, payment: { method: body.paymentMethod, paymentId: null, status: 'PENDING' }, status: 'PENDING_PAYMENT', source: 'WEB', rateSnapshot: pv.rateSnapshot, timeline: [{ status: 'CREATED', at: nowIso() }], notes: body.notes || null });

  if (body.paymentMethod === 'GOLD_WALLET') {
    const h = holdingFor(user.id);
    const raw = getRaw();
    const gramsNeeded = round3(pv.total / raw.sellGold24k);
    const available = round3(h.grams - (h.leasedGrams || 0));
    if (gramsNeeded > available + 1e-9) throw ApiError.badRequest(`Need ${gramsNeeded} gm but only ${available} gm available in your vault`);
    db.update('holdings', h.id, (x) => ({ ...x, grams: round3(x.grams - gramsNeeded) }));
    recordTxn({ userId: user.id, type: 'DIGI_REDEEM', title: `Vault gold used for order`, amount: pv.total, grams: gramsNeeded, rate: raw.sellGold24k, purity: '24K', status: 'SUCCESS', method: 'GOLD_WALLET', refModel: 'orders', refId: order.id, meta: { orderNo: order.orderNo } });
    const confirmed = confirmOrder(order.id, { method: 'GOLD_WALLET', paymentId: null });
    return { order: confirmed, payment: null };
  }
  const payment = createPayment({ userId: user.id, amount: pv.total, purpose: 'ORDER', ref: { model: 'orders', id: order.id }, description: `Order ${order.orderNo}`, meta: { orderId: order.id } });
  db.update('orders', order.id, (o) => ({ ...o, payment: { ...o.payment, paymentId: payment.id } }));
  return { order: db.findById('orders', order.id), payment };
}

function confirmOrder(orderId, { method, paymentId }) {
  const order = db.update('orders', orderId, (o) => ({ ...o, status: 'CONFIRMED', payment: { method, paymentId, status: 'PAID' }, timeline: [...o.timeline, { status: 'CONFIRMED', at: nowIso() }] }));
  for (const line of order.items) db.update('products', line.productId, (p) => ({ ...p, stockQty: Math.max(0, (p.stockQty ?? 1) - line.qty), inStock: (p.stockQty ?? 1) - line.qty > 0 }));
  recordTxn({ userId: order.userId, type: 'ORDER', title: `Order ${order.orderNo} (${order.items.length} item${order.items.length > 1 ? 's' : ''})`, amount: order.total, status: 'SUCCESS', method, paymentId, refModel: 'orders', refId: order.id, meta: { orderNo: order.orderNo } });
  db.insert('notifications', { userId: order.userId, type: 'ORDER', title: 'Order confirmed', body: `Order ${order.orderNo} is confirmed. ${order.delivery === 'PICKUP' ? `Ready for pickup at ${order.branchName}.` : 'We will ship it insured within 2 working days.'}`, link: `/orders/${order.id}`, read: false });
  return order;
}
onPaid('ORDER', (payment) => ({ order: confirmOrder(payment.meta.orderId, { method: payment.method, paymentId: payment.id }) }));
onPaid('ORDER:FAILED', (payment) => { db.update('orders', payment.meta.orderId, (o) => ({ ...o, payment: { ...o.payment, status: 'FAILED' }, timeline: [...o.timeline, { status: 'PAYMENT_FAILED', at: nowIso() }] })); });

export function listOrders(userId) { return db.find('orders', (o) => o.userId === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); }
export function getOrder(userId, id) {
  const o = db.findOne('orders', (x) => (x.id === id || x.orderNo === id) && x.userId === userId);
  if (!o) throw ApiError.notFound('Order not found');
  return o;
}
export function trackOrder(orderNo, mobile) {
  const o = db.findOne('orders', (x) => x.orderNo === orderNo);
  if (!o) throw ApiError.notFound('Order not found');
  const u = db.findById('users', o.userId);
  if (!u || u.mobile !== String(mobile)) throw ApiError.notFound('Order not found');
  return { orderNo: o.orderNo, status: o.status, timeline: o.timeline, delivery: o.delivery, items: o.items.map((i) => ({ name: i.name, qty: i.qty, image: i.image })), total: o.total };
}
export function cancelOrder(user, id) {
  const o = getOrder(user.id, id);
  if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(o.status)) throw ApiError.conflict(`Order is ${o.status}`);
  return db.update('orders', o.id, (x) => ({ ...x, status: 'CANCELLED', timeline: [...x.timeline, { status: 'CANCELLED', at: nowIso() }] }));
}
export const ORDER_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'CANCELLED'];
