/**
 * Admin API consumed by the separate admin panel repo. Protected by x-admin-key.
 * Generic CRUD for content collections + operational actions.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { ok, created } from '../utils/respond.js';
import { ApiError } from '../utils/ApiError.js';
import { validate } from '../middleware/validate.js';
import { requireAdminKey } from '../middleware/auth.js';
import { setBaseRates, getRates } from '../services/rates.js';
import * as bookGold from '../services/bookGold.js';
import * as advanceGold from '../services/advanceGold.js';
import { ORDER_STATUSES } from '../services/orders.js';
import { slugify, nowIso } from '../utils/money.js';

const r = Router();
r.use(requireAdminKey);

const CONTENT = ['banners', 'categories', 'collections', 'products', 'faqs', 'branches'];
const READ_ONLY = ['users', 'transactions', 'payments', 'orders', 'emaPlans', 'bookings', 'advances', 'holdings', 'interests', 'tickets', 'giftCards', 'notifications', 'leases'];

r.get('/stats', (req, res) => {
  const sum = (name, pred, key = 'amount') => db.find(name, pred).reduce((s, x) => s + (x[key] || 0), 0);
  ok(res, {
    customers: db.count('users', (u) => u.role === 'CUSTOMER'), products: db.count('products'), activeProducts: db.count('products', (p) => p.active !== false),
    orders: { total: db.count('orders'), pending: db.count('orders', (o) => ['CONFIRMED', 'PACKED'].includes(o.status)), revenue: sum('orders', (o) => !['PENDING_PAYMENT', 'CANCELLED'].includes(o.status), 'total') },
    digiGold: { gramsHeld: Math.round(sum('holdings', () => true, 'grams') * 1000) / 1000, invested: sum('holdings', () => true, 'investedAmount') },
    ema: { activePlans: db.count('emaPlans', (p) => p.status === 'ACTIVE'), collected: sum('emaPlans', () => true, 'totalPaid'), dueThisMonth: db.find('emaPlans', (p) => p.status === 'ACTIVE').filter((p) => p.installments.some((i) => ['DUE', 'UPCOMING'].includes(i.status) && i.dueDate.slice(0, 7) === nowIso().slice(0, 7))).length },
    bookings: { locked: db.count('bookings', (b) => b.status === 'LOCKED'), advanceHeld: sum('bookings', (b) => b.status === 'LOCKED', 'advanceAmount') },
    advanceGold: { active: db.count('advances', (a) => a.status === 'ACTIVE'), balance: sum('advances', (a) => a.status === 'ACTIVE') },
    openTickets: db.count('tickets', (t) => t.status === 'OPEN'), openInterests: db.count('interests', (i) => i.status !== 'CLOSED'),
    rates: getRates(),
  });
});

// Settings + rates
r.get('/settings', (req, res) => ok(res, db.settings()));
r.patch('/settings', (req, res) => ok(res, db.updateSettings(req.body || {}), { message: 'Settings updated' }));
r.post('/rates', validate({ body: z.object({ gold24k: z.number().positive().optional(), silver999: z.number().positive().optional(), manualOverride: z.boolean().optional() }) }), (req, res) => ok(res, setBaseRates(req.body), { message: 'Rates published' }));

// Generic content CRUD
r.get('/:collection', (req, res) => {
  const { collection } = req.params;
  if (![...CONTENT, ...READ_ONLY].includes(collection)) throw ApiError.notFound('Unknown collection');
  let rows = db.all(collection);
  const { q, status, userId, page = 1, limit = 50 } = req.query;
  if (q) rows = rows.filter((x) => JSON.stringify(x).toLowerCase().includes(String(q).toLowerCase()));
  if (status) rows = rows.filter((x) => x.status === status);
  if (userId) rows = rows.filter((x) => x.userId === userId || x.purchasedBy === userId);
  rows = [...rows].sort((a, b) => (a.order != null && b.order != null ? a.order - b.order : a.createdAt < b.createdAt ? 1 : -1));
  const p = Number(page), l = Math.min(200, Number(limit));
  ok(res, rows.slice((p - 1) * l, p * l), { pagination: { total: rows.length, page: p, limit: l, pages: Math.max(1, Math.ceil(rows.length / l)) } });
});
r.get('/:collection/:id', (req, res) => { const d = db.findById(req.params.collection, req.params.id); if (!d) throw ApiError.notFound('Not found'); ok(res, d); });
r.post('/:collection', (req, res) => {
  const { collection } = req.params;
  if (!CONTENT.includes(collection)) throw ApiError.forbidden('Collection is read-only');
  const body = { ...req.body };
  if (['products', 'categories', 'collections'].includes(collection) && body.name && !body.slug) body.slug = slugify(body.name);
  if (body.slug && db.findOne(collection, (x) => x.slug === body.slug)) throw ApiError.conflict('Slug already exists');
  if (collection === 'products' && !body.sku) body.sku = `KJ-${1000 + db.count('products') + 1}`;
  created(res, db.insert(collection, { active: true, order: db.count(collection) + 1, ...body }));
});
r.put('/:collection/:id', (req, res) => { const { collection, id } = req.params; if (!CONTENT.includes(collection)) throw ApiError.forbidden('Collection is read-only'); const d = db.update(collection, id, { ...req.body, id }); if (!d) throw ApiError.notFound('Not found'); ok(res, d); });
r.patch('/:collection/:id', (req, res) => { const { collection, id } = req.params; if (!CONTENT.includes(collection)) throw ApiError.forbidden('Collection is read-only'); const d = db.update(collection, id, req.body); if (!d) throw ApiError.notFound('Not found'); ok(res, d); });
r.delete('/:collection/:id', (req, res) => { const { collection, id } = req.params; if (!CONTENT.includes(collection)) throw ApiError.forbidden('Collection is read-only'); if (!db.remove(collection, id)) throw ApiError.notFound('Not found'); ok(res, { removed: true }); });
r.post('/:collection/reorder', validate({ body: z.object({ ids: z.array(z.string()) }) }), (req, res) => { req.body.ids.forEach((id, i) => db.update(req.params.collection, id, { order: i + 1 })); ok(res, { reordered: true }); });

// Operational actions
r.patch('/ops/orders/:id/status', validate({ body: z.object({ status: z.enum(ORDER_STATUSES), note: z.string().optional() }) }), (req, res) => { const o = db.update('orders', req.params.id, (x) => ({ ...x, status: req.body.status, timeline: [...x.timeline, { status: req.body.status, at: nowIso(), note: req.body.note }] })); if (!o) throw ApiError.notFound('Order not found'); ok(res, o); });
r.patch('/ops/interests/:id', validate({ body: z.object({ status: z.string(), quoteAmount: z.number().optional(), consultationAt: z.string().optional(), branchId: z.string().optional(), note: z.string().optional() }) }), (req, res) => { const d = db.update('interests', req.params.id, req.body); if (!d) throw ApiError.notFound('Not found'); ok(res, d); });
r.post('/ops/bookings/:id/redeem', validate({ body: z.object({ billNo: z.string().optional() }).default({}) }), (req, res) => ok(res, bookGold.redeem(req.params.id, req.body)));
r.post('/ops/advances/:id/redeem', validate({ body: z.object({ billNo: z.string().optional(), amountUsed: z.number().optional() }).default({}) }), (req, res) => ok(res, advanceGold.redeem(req.params.id, req.body)));
r.patch('/ops/tickets/:id', validate({ body: z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(), reply: z.string().optional() }) }), (req, res) => { const d = db.update('tickets', req.params.id, req.body); if (!d) throw ApiError.notFound('Not found'); ok(res, d); });
r.post('/ops/notifications', validate({ body: z.object({ userId: z.string().nullable().default(null), title: z.string(), body: z.string(), link: z.string().optional(), type: z.string().default('OFFER') }) }), (req, res) => created(res, db.insert('notifications', { ...req.body, read: false })));

export default r;
