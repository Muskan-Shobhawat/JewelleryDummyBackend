import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.STATE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kanak-')), 'state.json');
process.env.RATE_TICK_SECONDS = '3600';

const { db } = await import('../src/store/db.js');
const { initRates } = await import('../src/services/rates.js');
const { createApp } = await import('../src/app.js');

let server, base, token;
const api = async (p, { method = 'GET', body, auth = true, headers = {} } = {}) => {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json()) };
};
const pay = async (paymentId, body = {}) => api(`/api/payments/${paymentId}/confirm`, { method: 'POST', body });

before(async () => {
  db.load(); initRates();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const v = await api('/api/auth/verify-otp', { method: 'POST', auth: false, body: { mobile: '9999999999', otp: '123456' } });
  // verify requires send-otp first
  if (!v.success) { await api('/api/auth/send-otp', { method: 'POST', auth: false, body: { mobile: '9999999999' } }); }
  const v2 = await api('/api/auth/verify-otp', { method: 'POST', auth: false, body: { mobile: '9999999999', otp: '123456' } });
  token = v2.data.token;
});
after(() => server.close());

test('config exposes brand, theme and scheme settings', async () => {
  const r = await api('/api/config', { auth: false });
  assert.equal(r.status, 200);
  assert.equal(r.data.brand.name, 'Kanak Jewellers');
  assert.ok(r.data.theme.primary && r.data.ema.minMonthly && r.data.digiGold.minAmount);
});

test('rates include all purities and sell benchmark', async () => {
  const r = await api('/api/rates', { auth: false });
  assert.deepEqual(r.data.items.map((i) => i.key), ['gold24k', 'gold22k', 'gold18k', 'gold14k', 'silver999']);
  assert.ok(r.data.sell.gold24k < r.data.buy.gold24k);
  assert.ok(Math.abs(r.data.buy.gold22k / r.data.buy.gold24k - 0.916) < 0.001);
});

test('product pricing follows live rate and GST', async () => {
  const r = await api('/api/products/aurelia-gold-ring', { auth: false });
  const p = r.data.price;
  assert.equal(p.mode, 'RATE_LINKED');
  assert.equal(Math.round(p.metalValue), Math.round(p.netWeight * p.ratePerGram));
  assert.equal(p.total, Math.round(p.subtotal + p.gst));
  assert.match(r.data.whatsappUrl, /^https:\/\/wa\.me\/\d+\?text=/);
  const onCall = await api('/api/products/jhumar-pasa', { auth: false });
  assert.equal(onCall.data.price.priceOnCall, true);
});

test('virtual diamonds category lists diamond products', async () => {
  const r = await api('/api/products?category=diamonds', { auth: false });
  assert.ok(r.data.length > 0);
  assert.ok(r.data.every((p) => p.metal === 'DIAMOND'));
});

test('otp login rejects wrong code and issues token for right one', async () => {
  await api('/api/auth/send-otp', { method: 'POST', auth: false, body: { mobile: '9876501234' } });
  const bad = await api('/api/auth/verify-otp', { method: 'POST', auth: false, body: { mobile: '9876501234', otp: '000000' } });
  assert.equal(bad.status, 400);
  const good = await api('/api/auth/verify-otp', { method: 'POST', auth: false, body: { mobile: '9876501234', otp: '123456', name: 'New User' } });
  assert.equal(good.data.isNewUser, true);
  assert.ok(good.data.token);
});

test('digi gold buy credits vault only after payment success', async () => {
  const before = (await api('/api/digi-gold/portfolio')).data.grams;
  const buy = await api('/api/digi-gold/buy', { method: 'POST', body: { amount: 1000 } });
  assert.equal(buy.status, 201);
  const mid = (await api('/api/digi-gold/portfolio')).data.grams;
  assert.equal(mid, before, 'no credit before payment');
  const fail = await pay(buy.data.payment.paymentId, { outcome: 'failure' });
  assert.equal(fail.data.payment.status, 'FAILED');
  const buy2 = await api('/api/digi-gold/buy', { method: 'POST', body: { amount: 1000 } });
  const okp = await pay(buy2.data.payment.paymentId);
  assert.equal(okp.data.payment.status, 'PAID');
  const after = (await api('/api/digi-gold/portfolio')).data.grams;
  assert.ok(Math.abs(after - before - buy2.data.quote.grams) < 0.0011);
  const again = await pay(buy2.data.payment.paymentId);
  assert.equal((await api('/api/digi-gold/portfolio')).data.grams, after, 'confirm is idempotent');
  assert.equal(again.data.payment.status, 'PAID');
});

test('digi gold sell is capped at available balance', async () => {
  const r = await api('/api/digi-gold/sell', { method: 'POST', body: { grams: 999 } });
  assert.equal(r.status, 400);
});

test('ema instalment payment advances the plan', async () => {
  const plan = (await api('/api/ema/plans/ema_demo')).data;
  const next = plan.nextInstallment.n;
  const p = await api('/api/ema/plans/ema_demo/pay', { method: 'POST', body: {} });
  const done = await pay(p.data.payment.paymentId);
  assert.equal(done.data.result.plan.paidCount, plan.paidCount + 1);
  assert.equal(done.data.result.plan.installments.find((i) => i.n === next).status, 'PAID');
  const outOfRange = await api('/api/ema/calculate?monthly=1000', { auth: false });
  assert.equal(outOfRange.status, 400);
});

test('book my gold locks rate after advance payment', async () => {
  const b = await api('/api/book-gold/bookings', { method: 'POST', body: { purity: '22K', grams: 10 } });
  assert.equal(b.data.booking.status, 'PENDING_PAYMENT');
  assert.equal(b.data.payment.amount, Math.round(b.data.quote.totalValue * 0.1));
  const done = await pay(b.data.payment.paymentId);
  assert.equal(done.data.result.booking.status, 'LOCKED');
  assert.ok(done.data.result.booking.certificateNo);
});

test('advance gold converts to grams on payment', async () => {
  const a = await api('/api/advance-gold/contracts', { method: 'POST', body: { amount: 10000 } });
  const done = await pay(a.data.payment.paymentId, { method: 'NETBANKING' });
  assert.equal(done.data.result.advance.status, 'ACTIVE');
  assert.ok(done.data.result.advance.grams > 0 && done.data.result.advance.qrPass);
});

test('order checkout: preview, place, confirm', async () => {
  const pv = await api('/api/orders/preview', { method: 'POST', body: { items: [{ productId: 'prd_025', qty: 1 }], delivery: 'PICKUP' } });
  assert.equal(pv.data.shipping, 0);
  const o = await api('/api/orders', { method: 'POST', body: { items: [{ productId: 'prd_025', qty: 1 }], delivery: 'PICKUP', branchId: 'brn_main', paymentMethod: 'UPI' } });
  assert.equal(o.data.order.status, 'PENDING_PAYMENT');
  const done = await pay(o.data.payment.paymentId);
  assert.equal(done.data.result.order.status, 'CONFIRMED');
  const onCall = await api('/api/orders/preview', { method: 'POST', body: { items: [{ productId: 'prd_009' }] } });
  assert.equal(onCall.status, 400, 'price-on-call items cannot be checked out online');
});

test('admin api is key protected and can publish rates', async () => {
  const denied = await api('/api/admin/stats', { auth: false });
  assert.equal(denied.status, 403);
  const r = await api('/api/admin/rates', { method: 'POST', auth: false, headers: { 'x-admin-key': 'admin-demo-key' }, body: { gold24k: 15000, manualOverride: true } });
  assert.equal(r.data.items[0].pricePerGram, 15000);
  const price = await api('/api/products/classic-band-ring', { auth: false });
  assert.equal(price.data.price.ratePerGram, 15000 * 0.916);
  const ro = await api('/api/admin/users', { method: 'POST', auth: false, headers: { 'x-admin-key': 'admin-demo-key' }, body: {} });
  assert.equal(ro.status, 403);
});

test('admin api accepts ADMIN user tokens and rejects customers', async () => {
  const customer = await api('/api/admin/stats');
  assert.equal(customer.status, 403);
  await api('/api/auth/send-otp', { method: 'POST', auth: false, body: { mobile: '8888888888' } });
  const login = await api('/api/auth/verify-otp', { method: 'POST', auth: false, body: { mobile: '8888888888', otp: '123456' } });
  assert.equal(login.data.user.role, 'ADMIN');
  const stats = await api('/api/admin/stats', { auth: false, headers: { authorization: `Bearer ${login.data.token}` } });
  assert.equal(stats.status, 200);
  assert.ok(stats.data.customers >= 1);
});
