import 'dotenv/config';

const bool = (v, d = false) => (v === undefined ? d : String(v).toLowerCase() === 'true');

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  demoMode: bool(process.env.DEMO_MODE, true),
  demoOtp: process.env.DEMO_OTP || '123456',
  adminApiKey: process.env.ADMIN_API_KEY || 'admin-demo-key',
  rateTickSeconds: Number(process.env.RATE_TICK_SECONDS || 30),
  stateFile: process.env.STATE_FILE || '.data/state.json',
};
