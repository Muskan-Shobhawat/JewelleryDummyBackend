import { db } from '../store/db.js';
import { ApiError } from '../utils/ApiError.js';
import { decorateProduct } from './pricing.js';

const SORTS = {
  featured: (a, b) => Number(b.featured) - Number(a.featured) || a.order - b.order,
  newest: (a, b) => (a.createdAt < b.createdAt ? 1 : -1) || b.order - a.order,
  price_asc: (a, b) => (a.price.total ?? Infinity) - (b.price.total ?? Infinity),
  price_desc: (a, b) => (b.price.total ?? -1) - (a.price.total ?? -1),
  name_asc: (a, b) => a.name.localeCompare(b.name),
  popular: (a, b) => b.views - a.views,
};

export function listProducts(q, { user } = {}) {
  const { category, collection, tag, metal, purity, q: text, minPrice, maxPrice, sort = 'featured', page = 1, limit = 12, ids, inStock } = q;
  const idSet = ids ? new Set(String(ids).split(',')) : null;
  const needle = text ? text.toLowerCase() : null;
  const catDoc = category ? db.findOne('categories', (c) => c.slug === category) : null;
  const matchCategory = (p) => !category || p.category === category || (catDoc?.virtual && Object.entries(catDoc.filter || {}).every(([k, v]) => p[k] === v));
  let rows = db.find('products', (p) => p.active !== false
    && matchCategory(p)
    && (!collection || (p.collections || []).includes(collection))
    && (!tag || (p.tags || []).includes(tag))
    && (!metal || p.metal === metal.toUpperCase())
    && (!purity || p.purity === purity.toUpperCase())
    && (!idSet || idSet.has(p.id))
    && (inStock == null || p.inStock === inStock)
    && (!needle || p.name.toLowerCase().includes(needle) || p.category.includes(needle) || (p.tags || []).some((t) => t.includes(needle)) || p.sku.toLowerCase().includes(needle)))
    .map((p) => decorateProduct(p, { user }));
  if (minPrice != null) rows = rows.filter((p) => p.price.total != null && p.price.total >= minPrice);
  if (maxPrice != null) rows = rows.filter((p) => p.price.total != null && p.price.total <= maxPrice);
  rows.sort(SORTS[sort] || SORTS.featured);
  const total = rows.length;
  const start = (page - 1) * limit;
  return { rows: rows.slice(start, start + limit), total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

export function getProduct(slugOrId, { user } = {}) {
  const p = db.findOne('products', (x) => x.slug === slugOrId || x.id === slugOrId);
  if (!p || p.active === false) throw ApiError.notFound('Product not found');
  db.update('products', p.id, { views: (p.views || 0) + 1 });
  return decorateProduct(p, { user });
}

export function similarProducts(p, limit = 6) {
  return db.find('products', (x) => x.id !== p.id && x.active !== false && (x.category === p.category || (x.collections || []).some((c) => (p.collections || []).includes(c))))
    .slice(0, limit).map((x) => decorateProduct(x));
}

export function searchAll(text) {
  const needle = String(text || '').toLowerCase().trim();
  const s = db.settings();
  if (!needle) return { products: [], categories: [], collections: [], trending: TRENDING };
  return {
    products: listProducts({ q: needle, limit: 8 }).rows,
    categories: db.find('categories', (c) => c.active && c.name.toLowerCase().includes(needle)),
    collections: db.find('collections', (c) => c.active && c.name.toLowerCase().includes(needle)),
    trending: TRENDING,
    whatsappUrl: `https://wa.me/${s.contact.whatsappNumber}?text=${encodeURIComponent(`Hello ${s.brand.name}, I am looking for "${text}". Can you help?`)}`,
  };
}
export const TRENDING = ['Diamond Ring', 'Gold Necklace', 'Mangalsutra', 'Bridal Set', 'Tennis Bracelet', 'Gold Hoops', 'Gold Coin'];
