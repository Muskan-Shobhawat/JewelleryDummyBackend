import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { db } from '../store/db.js';
import { ApiError } from '../utils/ApiError.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, mobile: user.mobile, role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function resolveUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const user = db.findById('users', payload.sub);
    return user && user.isActive !== false ? user : null;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const user = resolveUser(req);
  if (!user) throw ApiError.unauthorized('Please login to continue');
  req.user = user;
  next();
}

export function optionalAuth(req, res, next) {
  req.user = resolveUser(req);
  next();
}

/** Admin access via x-admin-key (scripts) or a logged-in user with role ADMIN (admin panel). */
export function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key && key === env.adminApiKey) return next();
  const user = resolveUser(req);
  if (user?.role === 'ADMIN') { req.user = user; return next(); }
  throw ApiError.forbidden('Admin access required');
}
