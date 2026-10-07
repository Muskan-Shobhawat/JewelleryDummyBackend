import { db } from '../store/db.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { numericOtp } from '../utils/ids.js';
import { addDays, nowIso } from '../utils/money.js';
import { signToken } from '../middleware/auth.js';

const OTP_TTL_MS = 5 * 60 * 1000;

export function sendOtp(mobile) {
  const code = env.demoMode ? env.demoOtp : numericOtp(6);
  // invalidate previous
  for (const o of db.find('otps', (x) => x.mobile === mobile && !x.used)) db.update('otps', o.id, { used: true });
  const otp = db.insert('otps', { mobile, code, expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(), attempts: 0, used: false });
  // Real SMS provider integration goes here (MSG91, Twilio, etc.)
  console.log(`[auth] OTP for ${mobile}: ${code}`);
  const existing = db.findOne('users', (u) => u.mobile === mobile);
  return { mobile, expiresInSeconds: OTP_TTL_MS / 1000, isNewUser: !existing, ...(env.demoMode ? { demoOtp: code, note: 'Demo mode: OTP is returned in the response' } : {}) };
}

export function verifyOtp({ mobile, otp, name }) {
  const rec = db.find('otps', (x) => x.mobile === mobile && !x.used).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (!rec) throw ApiError.badRequest('Please request an OTP first');
  if (rec.expiresAt < nowIso()) throw ApiError.badRequest('OTP expired, please request a new one');
  if (rec.attempts >= 5) throw ApiError.badRequest('Too many attempts, please request a new OTP');
  if (rec.code !== String(otp) && !(env.demoMode && String(otp) === env.demoOtp)) {
    db.update('otps', rec.id, { attempts: rec.attempts + 1});
    throw ApiError.badRequest('Incorrect OTP');
  }
  db.update('otps', rec.id, { used: true });
  let user = db.findOne('users', (u) => u.mobile === mobile);
  let isNewUser = false;
  if (!user) {
    isNewUser = true;
    user = db.insert('users', { mobile, name: name || '', email: '', role: 'CUSTOMER', isActive: true, memberTier: 'Member', kyc: { status: 'PENDING' }, bank: null, address: null, wishlist: [], notificationsEnabled: true, language: 'en' });
  } else if (name && !user.name) {
    user = db.update('users', user.id, { name });
  }
  db.update('users', user.id, { lastLoginAt: nowIso() });
  return { token: signToken(user), user: publicUser(user), isNewUser };
}

export function publicUser(u) {
  const { ...rest } = u;
  return { ...rest, profileComplete: !!(u.name && u.email && u.address?.pincode), kycVerified: u.kyc?.status === 'VERIFIED', bankLinked: !!u.bank?.verified };
}

export function updateProfile(user, patch) { return publicUser(db.update('users', user.id, patch)); }

export function submitKyc(user, { pan, panName }) {
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw ApiError.badRequest('Invalid PAN format');
  // Demo: auto-verify. Real flow would call a KYC provider.
  return publicUser(db.update('users', user.id, { kyc: { pan, panName, status: 'VERIFIED', verifiedAt: nowIso(), method: 'DEMO_AUTO' } }));
}

export function linkBank(user, { holderName, accountNumber, ifsc, bankName }) {
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw ApiError.badRequest('Invalid IFSC');
  if (!/^\d{9,18}$/.test(accountNumber)) throw ApiError.badRequest('Invalid account number');
  // Demo: penny-drop verification is simulated
  return publicUser(db.update('users', user.id, { bank: { holderName, bankName: bankName || ifsc.slice(0, 4) + ' Bank', accountNumberMasked: 'XXXXXX' + accountNumber.slice(-4), ifsc, verified: true, verifiedAt: nowIso() } }));
}
