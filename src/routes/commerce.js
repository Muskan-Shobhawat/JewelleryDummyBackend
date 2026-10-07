import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { ok, created } from '../utils/respond.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import * as orders from '../services/orders.js';
import * as gift from '../services/giftCards.js';
import { createPayment, confirmPayment, getPayment, checkoutPayload } from '../services/payments.js';
import { whatsappLink } from '../services/pricing.js';
import { refNo } from '../utils/ids.js';

const r = Router();
const cartItem = z.object({ productId: z.string(), qty: z.number().int().min(1).max(10).default(1), size: z.string().optional() });
const address = z.object({ name: z.string().optional(), mobile: z.string().optional(), line1: z.string().min(3), line2: z.string().optional().default(''), landmark: z.string().optional().default(''), city: z.string().min(2), state: z.string().min(2), pincode: z.string().regex(/^\d{6}$/) });

// ---------- Orders / checkout ----------
r.post('/orders/preview', optionalAuth, validate({ body: z.object({ items: z.array(cartItem).min(1), couponCode: z.string().optional(), delivery: z.enum(['COURIER', 'PICKUP']).default('COURIER') }) }), (req, res) => ok(res, orders.preview(req.body, req.user)));
r.post('/orders/whatsapp-link', optionalAuth, validate({ body: z.object({ items: z.array(cartItem).min(1) }) }), (req, res) => ok(res, orders.whatsappOrderLink(req.body, req.user)));
r.post('/orders', requireAuth, validate({ body: z.object({ items: z.array(cartItem).min(1), couponCode: z.string().optional(), delivery: z.enum(['COURIER', 'PICKUP']).default('COURIER'), branchId: z.string().optional(), address: address.optional(), paymentMethod: z.string(), notes: z.string().max(500).optional() }) }), (req, res) => { const out = orders.placeOrder(req.user, req.body); created(res, { order: out.order, payment: out.payment ? checkoutPayload(out.payment) : null }, { message: out.payment ? 'Complete the payment to confirm your order' : 'Order confirmed using your Digi Gold wallet' }); });
r.get('/orders', requireAuth, (req, res) => ok(res, orders.listOrders(req.user.id)));
r.get('/orders/track', validate({ query: z.object({ orderNo: z.string(), mobile: z.string() }) }), (req, res) => ok(res, orders.trackOrder(req.q.orderNo, req.q.mobile)));
r.get('/orders/:id', requireAuth, (req, res) => ok(res, orders.getOrder(req.user.id, req.params.id)));
r.post('/orders/:id/cancel', requireAuth, (req, res) => ok(res, orders.cancelOrder(req.user, req.params.id), { message: 'Order cancelled' }));

// ---------- Payments (mock gateway) ----------
r.get('/payments/:id', requireAuth, (req, res) => ok(res, checkoutPayload(getPayment(req.params.id, req.user.id))));
r.post('/payments/:id/confirm', requireAuth, validate({ body: z.object({ outcome: z.enum(['success', 'failure']).default('success'), method: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET']).default('UPI'), failureReason: z.string().optional() }) }), (req, res) => {
  const out = confirmPayment(req.params.id, { ...req.body, userId: req.user.id });
  ok(res, { payment: out.payment, result: out.result }, { message: out.payment.status === 'PAID' ? 'Payment successful' : 'Payment failed' });
});
/** Webhook shape for a real gateway later (no auth; verify signature in production). */
r.post('/payments/webhook', validate({ body: z.object({ paymentId: z.string(), event: z.enum(['payment.captured', 'payment.failed']), method: z.string().optional() }) }), (req, res) => { const out = confirmPayment(req.body.paymentId, { outcome: req.body.event === 'payment.captured' ? 'success' : 'failure', method: req.body.method || 'UPI' }); ok(res, { status: out.payment.status }); });

// ---------- Gift cards ----------
r.get('/gift-cards', optionalAuth, (req, res) => ok(res, { config: db.settings().giftCards, mine: req.user ? gift.mine(req.user.id) : [] }));
r.post('/gift-cards', requireAuth, validate({ body: z.object({ amount: z.number().positive(), recipientName: z.string().trim().min(2), recipientMobile: z.string().regex(/^[6-9]\d{9}$/), message: z.string().max(200).optional() }) }), (req, res) => { const out = gift.purchase(req.user, req.body); created(res, { payment: checkoutPayload(out.payment) }, { message: 'Complete the payment to issue the gift card' }); });
r.get('/gift-cards/check/:code', (req, res) => ok(res, gift.check(req.params.code)));

// ---------- Contact / support (public) ----------
r.get('/contact', (req, res) => { const s = db.settings(); ok(res, { ...s.contact, whatsappUrl: whatsappLink(), branches: db.find('branches', (b) => b.active), channels: [{ type: 'WHATSAPP', label: 'Chat on WhatsApp', value: s.contact.whatsappNumber, url: whatsappLink() }, { type: 'CALL', label: 'Toll-free', value: s.contact.tollFree, url: `tel:${s.contact.tollFree}` }, { type: 'EMAIL', label: 'Email', value: s.contact.email, url: `mailto:${s.contact.email}` }] }); });
r.post('/contact', optionalAuth, validate({ body: z.object({ name: z.string().trim().min(2), mobile: z.string().regex(/^[6-9]\d{9}$/), email: z.string().email().optional().or(z.literal('')), subject: z.string().trim().min(2).max(120), message: z.string().trim().min(5).max(2000) }) }), (req, res) => created(res, db.insert('tickets', { ticketNo: refNo('TKT'), userId: req.user?.id || null, ...req.body, category: 'CONTACT', status: 'OPEN', reply: null }), { message: 'Thanks! We will get back to you within 2 working hours.' }));
r.get('/pages/about', (req, res) => { const s = db.settings(); ok(res, { brand: s.brand, story: [`${s.brand.name} has been crafting jewellery since ${s.brand.since}, blending Rajasthani heritage with modern design.`, 'Every piece is BIS hallmarked and every diamond is certified, with transparent pricing shown against the live gold rate.', 'Beyond jewellery, we help families build gold wealth through Digi Gold, monthly savings plans and rate-lock bookings.'], stats: [{ label: 'Years of trust', value: new Date().getFullYear() - s.brand.since }, { label: 'Showrooms', value: db.count('branches', (b) => b.active) }, { label: 'Designs', value: `${db.count('products')}+` }, { label: 'Happy families', value: '25,000+' }], trustBadges: s.trustBadges, branches: db.find('branches', (b) => b.active) }); });
r.get('/pages/:slug', (req, res) => { const s = db.settings(); const pages = { 'privacy-policy': { title: 'Privacy Policy', sections: [{ heading: 'Data we collect', body: 'Name, mobile number, email, address, PAN (for bullion compliance) and transaction history.' }, { heading: 'How we use it', body: 'To process orders, gold purchases, savings plans and to send transactional updates on SMS, WhatsApp and email.' }, { heading: 'Your rights', body: `Request data export or deletion by writing to ${s.contact.email}.` }] }, 'terms-and-conditions': { title: 'Terms and Conditions', sections: [{ heading: 'Pricing', body: 'Jewellery prices are linked to the published gold rate and are final at the time of payment.' }, { heading: 'Digi Gold', body: 'Purchases are backed by physical gold held with the vault partner. A buy/sell spread applies.' }, { heading: 'Swarn Sanchay', body: s.ema.terms.join(' ') }, { heading: 'Exchange', body: `Exchange within ${s.checkout.exchangeDays} days with original invoice.` }] } }; const p = pages[req.params.slug]; if (!p) return res.status(404).json({ success: false, message: 'Page not found' }); ok(res, p); });

export default r;
