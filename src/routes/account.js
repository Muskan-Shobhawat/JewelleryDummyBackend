import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { ok, created } from '../utils/respond.js';
import { ApiError } from '../utils/ApiError.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { decorateProduct, whatsappForProduct, priceProduct } from '../services/pricing.js';
import { portfolio } from '../services/digigold.js';
import { listPlans } from '../services/ema.js';
import * as bookGold from '../services/bookGold.js';
import * as advanceGold from '../services/advanceGold.js';
import { listTxns } from '../services/transactions.js';
import { nowIso } from '../utils/money.js';
import { refNo } from '../utils/ids.js';

const r = Router();
r.use(requireAuth);

/** One call for the account home / wallet page */
r.get('/dashboard', (req, res) => {
  const u = req.user;
  const txns = listTxns(u.id, { limit: 5 });
  ok(res, {
    user: { id: u.id, name: u.name, mobile: u.mobile, memberTier: u.memberTier, kycVerified: u.kyc?.status === 'VERIFIED', bankLinked: !!u.bank?.verified },
    digiGold: portfolio(u.id),
    ema: listPlans(u.id).filter((p) => ['ACTIVE', 'PENDING_FIRST_PAYMENT', 'MATURED'].includes(p.status)).map((p) => ({ id: p.id, planNo: p.planNo, monthlyAmount: p.monthlyAmount, paidCount: p.paidCount, tenureMonths: p.tenureMonths, progressPct: p.progressPct, nextInstallment: p.nextInstallment, status: p.status, goldAccumulatedGrams: p.goldAccumulatedGrams, maturityDate: p.maturityDate })),
    bookings: bookGold.list(u.id).filter((b) => b.status === 'LOCKED'),
    advanceGold: advanceGold.summary(u.id),
    recentTransactions: txns.rows, transactionSummary: txns.summary,
    unreadNotifications: db.count('notifications', (n) => (n.userId === u.id || n.userId === null) && !n.read),
    wishlistCount: (u.wishlist || []).length,
    interestsCount: db.count('interests', (i) => i.userId === u.id),
    giftCardsCount: db.count('giftCards', (g) => g.purchasedBy === u.id),
  });
});

// Wishlist
r.get('/wishlist', (req, res) => ok(res, (req.user.wishlist || []).map((id) => db.findById('products', id)).filter(Boolean).map((p) => decorateProduct(p, { user: req.user }))));
r.post('/wishlist/toggle', validate({ body: z.object({ productId: z.string() }) }), (req, res) => {
  if (!db.findById('products', req.body.productId)) throw ApiError.notFound('Product not found');
  const list = new Set(req.user.wishlist || []);
  const added = !list.has(req.body.productId);
  if (added) list.add(req.body.productId); else list.delete(req.body.productId);
  db.update('users', req.user.id, { wishlist: [...list] });
  ok(res, { productId: req.body.productId, inWishlist: added, wishlist: [...list] });
});
r.delete('/wishlist/:productId', (req, res) => { const list = (req.user.wishlist || []).filter((x) => x !== req.params.productId); db.update('users', req.user.id, { wishlist: list }); ok(res, { wishlist: list }); });

// Transactions
r.get('/transactions', validate({ query: z.object({ type: z.string().optional(), status: z.string().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }) }), (req, res) => {
  const out = listTxns(req.user.id, req.q);
  ok(res, out.rows, { pagination: { total: out.total, page: out.page, limit: out.limit, pages: out.pages }, summary: out.summary, tabs: [{ key: '', label: 'All' }, { key: 'DIGI_GOLD', label: 'Digi Gold' }, { key: 'EMA_INSTALLMENT', label: 'Swarn Sanchay' }, { key: 'ADVANCE_GOLD_DEPOSIT', label: 'Advance Gold' }, { key: 'BOOK_GOLD_ADVANCE', label: 'Book My Gold' }, { key: 'ORDER', label: 'Orders' }] });
});
r.get('/transactions/:id', (req, res) => { const t = db.findOne('transactions', (x) => (x.id === req.params.id || x.txnNo === req.params.id) && x.userId === req.user.id); if (!t) throw ApiError.notFound('Transaction not found'); ok(res, t); });

// My Interest (enquiries on products)
const INTEREST_STATUSES = ['INQUIRY_LOGGED', 'QUOTE_SHARED', 'CONSULTATION_SCHEDULED', 'SHOWROOM_READY', 'CLOSED'];
r.get('/interests', (req, res) => {
  const rows = db.find('interests', (i) => i.userId === req.user.id).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((i) => { const p = db.findById('products', i.productId); return { ...i, product: p ? decorateProduct(p, { user: req.user }) : null, branch: i.branchId ? db.findById('branches', i.branchId) : null }; });
  ok(res, rows, { statuses: INTEREST_STATUSES, counts: { all: rows.length, ...Object.fromEntries(['bridal', 'gold', 'diamond'].map((k) => [k, rows.filter((x) => x.product && ((k === 'bridal' && (x.product.tags || []).includes('bridal')) || (k === 'gold' && x.product.metal === 'GOLD' && !(x.product.tags || []).includes('bridal')) || (k === 'diamond' && x.product.metal === 'DIAMOND'))).length])) } });
});
r.post('/interests', validate({ body: z.object({ productId: z.string(), note: z.string().max(500).optional(), size: z.string().optional(), branchId: z.string().optional(), channel: z.enum(['WEB', 'WHATSAPP']).default('WEB') }) }), (req, res) => {
  const p = db.findById('products', req.body.productId);
  if (!p) throw ApiError.notFound('Product not found');
  const existing = db.findOne('interests', (i) => i.userId === req.user.id && i.productId === p.id && i.status !== 'CLOSED');
  const doc = existing || db.insert('interests', { userId: req.user.id, productId: p.id, status: 'INQUIRY_LOGGED', note: [req.body.note, req.body.size ? `Size ${req.body.size}` : null].filter(Boolean).join('. '), consultationAt: null, branchId: req.body.branchId || null, quoteAmount: null, channel: req.body.channel });
  const wa = whatsappForProduct(p, priceProduct(p));
  created(res, { ...doc, product: decorateProduct(p, { user: req.user }), whatsappUrl: wa.whatsappUrl }, { message: existing ? 'Already in your interests' : 'Interest logged. Our team will reach out shortly.' });
});
r.delete('/interests/:id', (req, res) => { const i = db.findById('interests', req.params.id); if (!i || i.userId !== req.user.id) throw ApiError.notFound('Not found'); db.remove('interests', i.id); ok(res, { removed: true }); });

// Notifications
r.get('/notifications', (req, res) => { const rows = db.find('notifications', (n) => n.userId === req.user.id || n.userId === null).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); ok(res, rows, { unread: rows.filter((n) => !n.read).length }); });
r.post('/notifications/read-all', (req, res) => { for (const n of db.find('notifications', (x) => (x.userId === req.user.id || x.userId === null) && !x.read)) db.update('notifications', n.id, { read: true, readAt: nowIso() }); ok(res, { read: true }); });
r.patch('/notifications/:id/read', (req, res) => { const n = db.findById('notifications', req.params.id); if (!n) throw ApiError.notFound('Not found'); ok(res, db.update('notifications', n.id, { read: true, readAt: nowIso() })); });

// Support tickets
r.post('/support/tickets', validate({ body: z.object({ subject: z.string().trim().min(3).max(120), message: z.string().trim().min(5).max(2000), category: z.enum(['ORDER', 'DIGI_GOLD', 'EMA', 'BOOKING', 'ADVANCE', 'OTHER']).default('OTHER') }) }), (req, res) => created(res, db.insert('tickets', { ticketNo: refNo('TKT'), userId: req.user.id, name: req.user.name, mobile: req.user.mobile, email: req.user.email, ...req.body, status: 'OPEN', reply: null }), { message: 'Ticket created. We respond within 2 working hours.' }));
r.get('/support/tickets', (req, res) => ok(res, db.find('tickets', (t) => t.userId === req.user.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))));

export default r;
