import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { notFound, errorHandler } from './middleware/error.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import schemeRoutes from './routes/schemes.js';
import commerceRoutes from './routes/commerce.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  // Allow configured origins, plus any localhost port outside production (Next dev may pick 3001, 3002, ...)
  const isLocal = (o) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  app.use(cors({
    credentials: true,
    origin: (origin, cb) => {
      if (!origin || env.corsOrigin.includes('*') || env.corsOrigin.includes(origin) || (env.nodeEnv !== 'production' && isLocal(origin))) return cb(null, true);
      return cb(null, false);
    },
  }));
  app.use(express.json({ limit: '1mb' }));
  if (env.nodeEnv !== 'test') app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/', (req, res) => res.json({ name: 'Kanak Jewellers API', docs: '/api/health', version: '1.0.0' }));
  app.use('/api', publicRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/me', accountRoutes);
  app.use('/api', schemeRoutes);
  app.use('/api', commerceRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
