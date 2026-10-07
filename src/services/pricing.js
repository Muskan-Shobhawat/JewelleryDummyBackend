import { db } from '../store/db.js';
import { rateForPurity } from './rates.js';
import { roundRupee, round2 } from '../utils/money.js';

/** Computes the live price breakdown for a product. */
export function priceProduct(p) {
  const gstPct = db.settings().checkout.gstPct;
  if (p.pricingMode === 'ON_CALL') {
    return { mode: 'ON_CALL', priceOnCall: true, total: null, label: 'Price on call' };
  }
  if (p.pricingMode === 'FIXED') {
    const total = roundRupee(p.fixedPrice);
    const base = roundRupee(total / (1 + gstPct / 100));
    return { mode: 'FIXED', priceOnCall: false, total, subtotal: base, gst: total - base, gstPct, mrp: p.mrp ?? null, discount: p.mrp ? p.mrp - total : 0, label: null };
  }
  const ratePerGram = rateForPurity(p.purity);
  const metalValue = round2(p.netWeight * ratePerGram);
  const mc = p.makingCharge || { type: 'PCT', value: 0 };
  let makingCharge = mc.type === 'PCT' ? metalValue * (mc.value / 100) : mc.type === 'PER_GRAM' ? p.netWeight * mc.value : mc.value;
  makingCharge = round2(makingCharge);
  const stoneCharge = round2(p.stoneCharge || 0);
  const discount = round2(makingCharge * ((p.discountPct || 0) / 100));
  const subtotal = round2(metalValue + makingCharge + stoneCharge - discount);
  const gst = round2(subtotal * (gstPct / 100));
  const total = roundRupee(subtotal + gst);
  const mrp = discount > 0 ? roundRupee((subtotal + discount) * (1 + gstPct / 100)) : null;
  return { mode: 'RATE_LINKED', priceOnCall: false, ratePerGram, purity: p.purity, netWeight: p.netWeight, metalValue, makingCharge, makingChargeRule: mc, stoneCharge, discount, discountPct: p.discountPct || 0, subtotal, gst, gstPct, total, mrp, label: null };
}

export function decorateProduct(p, { user } = {}) {
  const category = db.findOne('categories', (c) => c.slug === p.category);
  const price = priceProduct(p);
  const { whatsappUrl } = whatsappForProduct(p, price);
  return {
    ...p,
    categoryName: category?.name ?? p.category,
    price,
    whatsappUrl,
    inWishlist: user ? (user.wishlist || []).includes(p.id) : false,
  };
}

export function whatsappForProduct(p, price) {
  const s = db.settings();
  const priceText = price?.total ? `₹${price.total.toLocaleString('en-IN')}` : 'Price on call';
  const text = `Hello ${s.brand.name}, I am interested in *${p.name}* (SKU ${p.sku}, ${p.purity}${p.netWeight ? `, ${p.netWeight} gm` : ''}). Listed at ${priceText}. Please share details and availability.`;
  return { text, whatsappUrl: `https://wa.me/${s.contact.whatsappNumber}?text=${encodeURIComponent(text)}` };
}

export function whatsappLink(text) {
  const s = db.settings();
  return `https://wa.me/${s.contact.whatsappNumber}?text=${encodeURIComponent(text || s.contact.whatsappDefaultText)}`;
}
