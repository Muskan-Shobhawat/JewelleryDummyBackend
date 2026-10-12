import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { env } from '../config/env.js';
import { ok } from '../utils/respond.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth } from '../middleware/auth.js';
import { getRates, getHistory, subscribe } from '../services/rates.js';
import { listProducts, getProduct, similarProducts, searchAll, TRENDING } from '../services/catalog.js';
import { whatsappLink } from '../services/pricing.js';

const r = Router();

r.get('/health', (req, res) => ok(res, { status: 'ok', uptime: process.uptime(), demoMode: env.demoMode, dataSource: db.loadedFrom }));

/** Everything the frontend needs at boot: brand, theme, contact, scheme configs */
r.get('/config', (req, res) => {
  const s = db.settings();
  ok(res, {
    brand: s.brand, theme: s.theme, contact: { ...s.contact, whatsappUrl: whatsappLink() }, announcement: s.announcement, trustBadges: s.trustBadges,
    digiGold: s.digiGold, ema: s.ema, bookGold: s.bookGold, advanceGold: s.advanceGold, checkout: s.checkout, giftCards: s.giftCards, coupons: (s.coupons || []).map(({ code, description }) => ({ code, description })),
    rates: { publishTimes: s.rates.publishTimes, source: s.rates.source }, demo: { mode: env.demoMode, otp: env.demoMode ? env.demoOtp : undefined, customerMobile: env.demoMode ? '9999999999' : undefined, adminMobile: env.demoMode ? '8888888888' : undefined },
    nav: [
      { label: 'Home', path: '/' }, { label: 'Jewellery', path: '/jewellery' }, { label: 'Digi Gold', path: '/digi-gold' }, { label: s.ema.title, path: '/ema' }, { label: 'Book My Gold', path: '/book-my-gold' }, { label: 'Advance Gold', path: '/advance-gold' }, { label: 'Gift Cards', path: '/gift-cards' }, { label: 'Contact', path: '/contact' },
    ],
    bottomNav: [
      { label: 'Home', path: '/', icon: 'home' }, { label: 'Jewellery', path: '/jewellery', icon: 'gem' }, { label: 'Wallet', path: '/wallet', icon: 'wallet' }, { label: 'My Txn', path: '/transactions', icon: 'receipt' }, { label: 'Contact', path: '/contact', icon: 'phone' },
    ],
  });
});

r.get('/rates', (req, res) => ok(res, getRates()));
r.get('/rates/history', validate({ query: z.object({ limit: z.coerce.number().int().min(2).max(500).default(96) }) }), (req, res) => ok(res, getHistory(req.q.limit)));
r.get('/rates/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (data) => res.write(`event: rates\ndata: ${JSON.stringify(data)}\n\n`);
  send(getRates());
  const unsub = subscribe(send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { unsub(); clearInterval(ping); });
});

r.get('/banners', validate({ query: z.object({ placement: z.string().optional() }) }), (req, res) => ok(res, db.find('banners', (b) => b.active && (!req.q.placement || b.placement === req.q.placement)).sort((a, b) => a.order - b.order)));
r.get('/categories', (req, res) => ok(res, db.find('categories', (c) => c.active).sort((a, b) => a.order - b.order).map((c) => ({ ...c, productCount: db.count('products', (p) => p.active !== false && (p.category === c.slug || (c.virtual && Object.entries(c.filter || {}).every(([k, v]) => p[k] === v)))) }))));
r.get('/collections', (req, res) => ok(res, db.find('collections', (c) => c.active).sort((a, b) => a.order - b.order).map((c) => ({ ...c, productCount: db.count('products', (p) => (p.collections || []).includes(c.slug) && p.active !== false) }))));
r.get('/branches', (req, res) => ok(res, db.find('branches', (b) => b.active)));
r.get('/faqs', validate({ query: z.object({ section: z.string().optional() }) }), (req, res) => {
  const rows = db.find('faqs', (f) => f.active && (!req.q.section || f.section === req.q.section || f.section.startsWith(req.q.section + '-'))).sort((a, b) => a.order - b.order);
  const sections = [...new Set(rows.map((f) => f.section))];
  ok(res, { sections, rows });
});

const listQuery = z.object({
  category: z.string().optional(), collection: z.string().optional(), tag: z.string().optional(), metal: z.string().optional(), purity: z.string().optional(), q: z.string().optional(), ids: z.string().optional(),
  minPrice: z.coerce.number().optional(), maxPrice: z.coerce.number().optional(), inStock: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sort: z.enum(['featured', 'newest', 'price_asc', 'price_desc', 'name_asc', 'popular']).default('featured'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(60).default(12),
});
r.get('/products', optionalAuth, validate({ query: listQuery }), (req, res) => { const out = listProducts(req.q, { user: req.user }); ok(res, out.rows, { pagination: { total: out.total, page: out.page, limit: out.limit, pages: out.pages }, filters: { categories: db.find('categories', (c) => c.active).map(({ slug, name }) => ({ slug, name })), tags: ['new', 'bestseller', 'trending', 'bridal', 'offer', 'investment', 'gifting'], metals: ['GOLD', 'DIAMOND', 'SILVER'], purities: ['24K', '22K', '18K', '925', '999'], sorts: ['featured', 'newest', 'price_asc', 'price_desc', 'name_asc', 'popular'] } }); });
r.get('/products/home', optionalAuth, (req, res) => {
  const o = { user: req.user, limit: 8 };
  ok(res, { newArrivals: listProducts({ tag: 'new', limit: 8, sort: 'newest' }, o).rows, bestSellers: listProducts({ tag: 'bestseller', limit: 8 }, o).rows, trending: listProducts({ tag: 'trending', limit: 8, sort: 'popular' }, o).rows, featured: listProducts({ limit: 8 }, o).rows.filter((p) => p.featured), diamondEdit: listProducts({ collection: 'diamond-edit', limit: 6 }, o).rows });
});
r.get('/products/:slug', optionalAuth, (req, res) => { const p = getProduct(req.params.slug, { user: req.user }); ok(res, { ...p, similar: similarProducts(p) }); });
r.get('/search', validate({ query: z.object({ q: z.string().optional() }) }), (req, res) => ok(res, searchAll(req.q.q)));
r.get('/search/trending', (req, res) => ok(res, TRENDING));

export default r;
