import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 4) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Internal id like "txn_7f3k2m" */
export function newId(prefix) {
  return `${prefix}_${randomCode(8).toLowerCase()}`;
}

/** Customer facing reference like "TXN-2610-7F3K2" */
export function refNo(prefix, len = 5) {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${prefix}-${yymm}-${randomCode(len)}`;
}

export function numericOtp(len = 6) {
  return String(crypto.randomInt(0, 10 ** len)).padStart(len, '0');
}
