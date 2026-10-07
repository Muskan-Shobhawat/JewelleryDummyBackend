import { db } from '../store/db.js';
import { refNo } from '../utils/ids.js';

const PREFIX = { DIGI_BUY: 'TXN', DIGI_SELL: 'TXN', DIGI_LEASE: 'LSE', DIGI_REDEEM: 'RDM', EMA_INSTALLMENT: 'EMA', BOOK_GOLD_ADVANCE: 'BMG', BOOK_GOLD_REFUND: 'BMG', ADVANCE_GOLD_DEPOSIT: 'ADV', ORDER: 'ORD', GIFT_CARD: 'GFT' };

export function recordTxn({ userId, type, title, amount, grams = null, rate = null, purity = null, status = 'SUCCESS', method = null, paymentId = null, refModel = null, refId = null, meta = {} }) {
  return db.insert('transactions', { txnNo: refNo(PREFIX[type] || 'TXN'), userId, type, title, amount, grams, rate, purity, status, method, paymentId, refModel, refId, meta });
}

export function listTxns(userId, { type, status, page = 1, limit = 20 } = {}) {
  let rows = db.find('transactions', (t) => t.userId === userId && (!type || t.type === type || (type === 'DIGI_GOLD' && t.type.startsWith('DIGI_'))) && (!status || t.status === status));
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const total = rows.length;
  const start = (page - 1) * limit;
  const summary = {
    totalTransacted: rows.filter((t) => ['SUCCESS', 'CREDITED', 'RATE_LOCKED'].includes(t.status) && t.type !== 'DIGI_SELL').reduce((s, t) => s + t.amount, 0),
    count: total,
    goldAccumulatedGrams: Math.round(rows.filter((t) => ['DIGI_BUY', 'EMA_INSTALLMENT', 'ADVANCE_GOLD_DEPOSIT'].includes(t.type)).reduce((s, t) => s + (t.grams || 0), 0) * 1000) / 1000,
  };
  return { rows: rows.slice(start, start + limit), total, page, limit, pages: Math.ceil(total / limit), summary };
}
