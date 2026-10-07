import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

export function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const status = err instanceof ApiError ? err.status : err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(err.details ? { details: err.details } : {}),
    ...(env.nodeEnv !== 'production' && status >= 500 ? { stack: err.stack } : {}),
  });
}
