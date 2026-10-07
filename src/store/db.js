/**
 * Tiny in-memory document store backed by JSON seed files in src/data.
 * Runtime changes are persisted (debounced) to STATE_FILE so demo actions
 * survive restarts. `npm run reset` deletes that file and restores seed data.
 *
 * Swapping this for MongoDB later only means re-implementing these methods.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { newId } from '../utils/ids.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const STATE_PATH = path.resolve(process.cwd(), env.stateFile);

const PREFIX = {
  users: 'usr', products: 'prd', categories: 'cat', collections: 'col', banners: 'bnr', faqs: 'faq',
  branches: 'brn', holdings: 'hld', emaPlans: 'ema', bookings: 'bkg', advances: 'adv', transactions: 'txn',
  payments: 'pay', interests: 'int', orders: 'ord', giftCards: 'gft', tickets: 'tkt', notifications: 'ntf',
  otps: 'otp', rates: 'rte', wishlists: 'wsl', leases: 'lse',
};

class Store {
  constructor() { this.collections = {}; this._timer = null; this.loadedFrom = null; }

  load() {
    if (fs.existsSync(STATE_PATH)) {
      this.collections = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      this.loadedFrom = STATE_PATH;
    } else {
      this.collections = {};
      for (const file of fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))) {
        this.collections[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      }
      this.loadedFrom = DATA_DIR;
    }
    for (const name of Object.keys(PREFIX)) this.collections[name] ??= [];
    return this;
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
        fs.writeFileSync(STATE_PATH, JSON.stringify(this.collections));
      } catch (e) { console.error('[db] persist failed', e.message); }
    }, 250);
  }

  all(name) { return this.collections[name] ?? (this.collections[name] = []); }
  find(name, pred = () => true) { return this.all(name).filter(pred); }
  findOne(name, pred) { return this.all(name).find(pred) ?? null; }
  findById(name, id) { return this.findOne(name, (d) => d.id === id); }
  count(name, pred = () => true) { return this.find(name, pred).length; }

  insert(name, doc) {
    const now = new Date().toISOString();
    const full = { id: doc.id ?? newId(PREFIX[name] ?? name.slice(0, 3)), createdAt: now, updatedAt: now, ...doc };
    this.all(name).push(full);
    this.save();
    return full;
  }

  update(name, id, patch) {
    const doc = this.findById(name, id);
    if (!doc) return null;
    const next = typeof patch === 'function' ? patch(doc) : { ...doc, ...patch };
    Object.assign(doc, next, { updatedAt: new Date().toISOString() });
    this.save();
    return doc;
  }

  remove(name, id) {
    const arr = this.all(name);
    const i = arr.findIndex((d) => d.id === id);
    if (i === -1) return false;
    arr.splice(i, 1);
    this.save();
    return true;
  }

  /** Single settings document */
  settings() { return this.all('settings')[0] ?? (this.all('settings')[0] = {}); }
  updateSettings(patch) {
    const s = this.settings();
    deepMerge(s, patch);
    s.updatedAt = new Date().toISOString();
    this.save();
    return s;
  }
}

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

export const db = new Store();
export { STATE_PATH };
