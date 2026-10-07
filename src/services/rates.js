/**
 * Live rate engine. Simulates a bullion feed around the base rates in settings
 * with a bounded random walk. Admin can set manualOverride to pin rates.
 * Frontend consumes GET /api/rates (poll) or GET /api/rates/stream (SSE).
 */
import { db } from '../store/db.js';
import { env } from '../config/env.js';
import { round2 } from '../utils/money.js';

const LABELS = {
  gold24k: { label: 'Gold 24K', purity: '999', metal: 'GOLD', karat: '24K' },
  gold22k: { label: 'Gold 22K', purity: '916', metal: 'GOLD', karat: '22K' },
  gold18k: { label: 'Gold 18K', purity: '750', metal: 'GOLD', karat: '18K' },
  gold14k: { label: 'Gold 14K', purity: '585', metal: 'GOLD', karat: '14K' },
  silver999: { label: 'Silver 999', purity: '999', metal: 'SILVER', karat: '999' },
};

const PURITY_TO_KEY = { '24K': 'gold24k', '22K': 'gold22k', '18K': 'gold18k', '14K': 'gold14k', '999': 'silver999', '925': 'silver925' };

const subscribers = new Set();
let current = null; // { gold24k, silver999, updatedAt }
let dayOpen = null; // reference for change calc
let timer = null;

const cfg = () => db.settings().rates;

function derive(gold24k, silver999) {
  const c = cfg();
  const f = c.purityFactors;
  return {
    gold24k: round2(gold24k),
    gold22k: round2(gold24k * f.gold22k),
    gold18k: round2(gold24k * f.gold18k),
    gold14k: round2(gold24k * f.gold14k),
    silver999: round2(silver999),
    silver925: round2(silver999 * 0.925),
    sellGold24k: round2(gold24k * (1 - c.sellSpreadPct / 100)),
    sellSilver999: round2(silver999 * (1 - c.sellSpreadPct / 100)),
  };
}

export function initRates() {
  const c = cfg();
  const history = db.all('rates');
  const last = history[history.length - 1];
  // keep the last persisted point if it is from today, else open fresh at base
  const today = new Date().toISOString().slice(0, 10);
  if (last && last.at.slice(0, 10) === today && !c.manualOverride) {
    current = { gold24k: last.gold24k, silver999: last.silver999, updatedAt: last.at };
    dayOpen = { gold24k: history.find((h) => h.at.slice(0, 10) === today)?.gold24k ?? c.base.gold24k, silver999: history.find((h) => h.at.slice(0, 10) === today)?.silver999 ?? c.base.silver999 };
  } else {
    current = { gold24k: c.base.gold24k, silver999: c.base.silver999, updatedAt: new Date().toISOString() };
    dayOpen = { ...c.base };
    pushHistory();
  }
  if (timer) clearInterval(timer);
  timer = setInterval(tick, Math.max(5, env.rateTickSeconds) * 1000);
  timer.unref?.();
  return getRates();
}

function pushHistory() {
  const arr = db.all('rates');
  arr.push({ id: `rte_${Date.now()}`, ...derive(current.gold24k, current.silver999), at: current.updatedAt });
  if (arr.length > 500) arr.splice(0, arr.length - 500);
  db.save();
}

function walk(value, base, jitterPct, maxDriftPct) {
  const step = (Math.random() - 0.5) * 2 * (jitterPct / 100) * base;
  const lo = base * (1 - maxDriftPct / 100);
  const hi = base * (1 + maxDriftPct / 100);
  return Math.min(hi, Math.max(lo, value + step));
}

export function tick() {
  const c = cfg();
  if (!c.manualOverride) {
    current = {
      gold24k: walk(current.gold24k, c.base.gold24k, c.jitterPct, c.maxDriftPct),
      silver999: walk(current.silver999, c.base.silver999, c.jitterPct, c.maxDriftPct),
      updatedAt: new Date().toISOString(),
    };
  } else {
    current = { gold24k: c.base.gold24k, silver999: c.base.silver999, updatedAt: new Date().toISOString() };
  }
  pushHistory();
  broadcast();
  return getRates();
}

/** Admin: set the published base rates (and optionally pin them). */
export function setBaseRates({ gold24k, silver999, manualOverride }) {
  const patch = { rates: { base: {} } };
  if (gold24k != null) patch.rates.base.gold24k = gold24k;
  if (silver999 != null) patch.rates.base.silver999 = silver999;
  if (manualOverride != null) patch.rates.manualOverride = manualOverride;
  db.updateSettings(patch);
  const c = cfg();
  current = { gold24k: c.base.gold24k, silver999: c.base.silver999, updatedAt: new Date().toISOString() };
  dayOpen = { ...c.base };
  pushHistory();
  broadcast();
  return getRates();
}

export function getRaw() { return derive(current.gold24k, current.silver999); }

/** Rate per gram for a purity string like "22K", "24K", "999", "925" */
export function rateForPurity(purity) {
  const key = PURITY_TO_KEY[String(purity).toUpperCase()];
  if (!key) throw new Error(`Unknown purity ${purity}`);
  return getRaw()[key];
}

export function getRates() {
  const c = cfg();
  const raw = getRaw();
  const open = derive(dayOpen.gold24k, dayOpen.silver999);
  const items = Object.entries(LABELS).map(([key, meta]) => {
    const price = raw[key];
    const change = round2(price - open[key]);
    return { key, ...meta, pricePerGram: price, unit: 'gm', change, changePct: round2((change / open[key]) * 100), trend: change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'FLAT' };
  });
  return {
    updatedAt: current.updatedAt,
    source: c.source,
    publishTimes: c.publishTimes,
    isLive: !c.manualOverride,
    items,
    buy: { gold24k: raw.gold24k, gold22k: raw.gold22k, gold18k: raw.gold18k, gold14k: raw.gold14k, silver999: raw.silver999, silver925: raw.silver925 },
    sell: { gold24k: raw.sellGold24k, silver999: raw.sellSilver999, spreadPct: c.sellSpreadPct },
    gstPct: db.settings().digiGold.gstPct,
  };
}

export function getHistory(limit = 96) {
  const arr = db.all('rates');
  return arr.slice(-limit).map((h) => ({ at: h.at, gold24k: h.gold24k, gold22k: h.gold22k, silver999: h.silver999 }));
}

export function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
function broadcast() { const payload = getRates(); for (const fn of subscribers) { try { fn(payload); } catch { /* ignore */ } } }
