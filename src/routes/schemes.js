import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { ok, created } from '../utils/respond.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import * as digi from '../services/digigold.js';
import * as ema from '../services/ema.js';
import * as bookGold from '../services/bookGold.js';
import * as advanceGold from '../services/advanceGold.js';
import { checkoutPayload } from '../services/payments.js';
import { listTxns } from '../services/transactions.js';

const r = Router();
const pay = (p) => (p ? checkoutPayload(p) : null);

// ---------- Digi Gold ----------
r.get('/digi-gold', optionalAuth, (req, res) => { const s = db.settings(); ok(res, { config: s.digiGold, faqs: db.find('faqs', (f) => f.active && f.section.startsWith('digigold')).sort((a, b) => a.order - b.order), portfolio: req.user ? digi.portfolio(req.user.id) : null }); });
r.get('/digi-gold/quote', validate({ query: z.object({ side: z.enum(['buy', 'sell']).default('buy'), amount: z.coerce.number().positive().optional(), grams: z.coerce.number().positive().optional() }) }), (req, res) => ok(res, digi.quote(req.q)));
r.get('/digi-gold/portfolio', requireAuth, (req, res) => ok(res, { ...digi.portfolio(req.user.id), leases: digi.listLeases(req.user.id), recent: listTxns(req.user.id, { type: 'DIGI_GOLD', limit: 10 }).rows }));
r.post('/digi-gold/buy', requireAuth, validate({ body: z.object({ amount: z.number().positive().optional(), grams: z.number().positive().optional() }) }), (req, res) => { const out = digi.buy(req.user, req.body); created(res, { quote: out.quote, payment: pay(out.payment) }, { message: 'Complete the payment to credit gold to your vault' }); });
r.post('/digi-gold/sell', requireAuth, validate({ body: z.object({ grams: z.number().positive().optional(), sellAll: z.boolean().optional() }) }), (req, res) => ok(res, digi.sell(req.user, req.body), { message: 'Gold sold. Payout initiated via IMPS.' }));
r.post('/digi-gold/lease', requireAuth, validate({ body: z.object({ grams: z.number().positive(), months: z.number().int() }) }), (req, res) => created(res, digi.lease(req.user, req.body), { message: 'Lease created' }));
r.post('/digi-gold/redeem', requireAuth, validate({ body: z.object({ type: z.enum(['COIN', 'VOUCHER']), grams: z.number().positive(), branchId: z.string().optional() }) }), (req, res) => created(res, digi.redeem(req.user, req.body), { message: req.body.type === 'COIN' ? 'Coin redemption placed' : 'Jewellery voucher generated' }));

// ---------- EMA / Swarn Sanchay ----------
r.get('/ema', optionalAuth, (req, res) => { const s = db.settings(); ok(res, { config: s.ema, faqs: db.find('faqs', (f) => f.active && f.section === 'ema').sort((a, b) => a.order - b.order), plans: req.user ? ema.listPlans(req.user.id) : [] }); });
r.get('/ema/calculate', validate({ query: z.object({ monthly: z.coerce.number() }) }), (req, res) => ok(res, ema.calculate(req.q.monthly)));
r.get('/ema/plans', requireAuth, (req, res) => ok(res, ema.listPlans(req.user.id)));
r.post('/ema/enrol', requireAuth, validate({ body: z.object({ monthlyAmount: z.number(), autopay: z.boolean().optional(), autopayMethod: z.string().optional(), branchId: z.string().optional() }) }), (req, res) => { const out = ema.enrol(req.user, req.body); created(res, { plan: out.plan, calc: out.calc, payment: pay(out.payment) }, { message: 'Plan created. Pay the first instalment to activate.' }); });
r.get('/ema/plans/:id', requireAuth, (req, res) => ok(res, ema.getPlan(req.user.id, req.params.id)));
r.post('/ema/plans/:id/pay', requireAuth, validate({ body: z.object({ installment: z.number().int().optional() }).default({}) }), (req, res) => { const out = ema.payNext(req.user, req.params.id, req.body); created(res, { installment: out.installment, payment: pay(out.payment) }); });
r.patch('/ema/plans/:id/autopay', requireAuth, validate({ body: z.object({ enabled: z.boolean(), method: z.string().optional(), vpa: z.string().optional() }) }), (req, res) => ok(res, ema.setAutopay(req.user, req.params.id, req.body), { message: req.body.enabled ? 'Autopay enabled' : 'Autopay disabled' }));
r.post('/ema/plans/:id/redeem', requireAuth, validate({ body: z.object({ branchId: z.string().optional(), note: z.string().optional() }).default({}) }), (req, res) => ok(res, ema.requestRedemption(req.user, req.params.id, req.body), { message: 'Redemption requested. Visit the showroom with your voucher.' }));

// ---------- Book My Gold ----------
r.get('/book-gold', optionalAuth, (req, res) => { const s = db.settings(); ok(res, { config: s.bookGold, branches: db.find('branches', (b) => b.active), faqs: db.find('faqs', (f) => f.active && f.section === 'book-gold'), bookings: req.user ? bookGold.list(req.user.id) : [] }); });
r.get('/book-gold/quote', validate({ query: z.object({ purity: z.enum(['22K', '24K']).default('22K'), grams: z.coerce.number().positive() }) }), (req, res) => ok(res, bookGold.quote(req.q)));
r.get('/book-gold/bookings', requireAuth, (req, res) => ok(res, bookGold.list(req.user.id)));
r.post('/book-gold/bookings', requireAuth, validate({ body: z.object({ purity: z.enum(['22K', '24K']).default('22K'), grams: z.number().positive(), branchId: z.string().optional(), purpose: z.string().optional() }) }), (req, res) => { const out = bookGold.create(req.user, req.body); created(res, { quote: out.quote, booking: out.booking, payment: pay(out.payment) }, { message: 'Pay the advance to lock the rate' }); });
r.get('/book-gold/bookings/:id', requireAuth, (req, res) => ok(res, bookGold.get(req.user.id, req.params.id)));
r.post('/book-gold/bookings/:id/cancel', requireAuth, (req, res) => ok(res, bookGold.cancel(req.user, req.params.id), { message: 'Booking cancelled. Advance refund in 5-7 working days.' }));

// ---------- Advance Gold ----------
r.get('/advance-gold', optionalAuth, (req, res) => { const s = db.settings(); ok(res, { config: s.advanceGold, branches: db.find('branches', (b) => b.active), faqs: db.find('faqs', (f) => f.active && f.section === 'advance-gold'), summary: req.user ? advanceGold.summary(req.user.id) : null, contracts: req.user ? advanceGold.list(req.user.id) : [] }); });
r.get('/advance-gold/quote', validate({ query: z.object({ amount: z.coerce.number().positive() }) }), (req, res) => ok(res, advanceGold.quote(req.q)));
r.get('/advance-gold/contracts', requireAuth, (req, res) => ok(res, advanceGold.list(req.user.id), { summary: advanceGold.summary(req.user.id) }));
r.post('/advance-gold/contracts', requireAuth, validate({ body: z.object({ amount: z.number().positive(), method: z.string().optional() }) }), (req, res) => { const out = advanceGold.create(req.user, req.body); created(res, { quote: out.quote, advance: out.advance, payment: pay(out.payment) }, { message: 'Complete the payment to activate your advance' }); });
r.get('/advance-gold/contracts/:id', requireAuth, (req, res) => ok(res, advanceGold.get(req.user.id, req.params.id)));

export default r;
