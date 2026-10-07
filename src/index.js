import { env } from './config/env.js';
import { db } from './store/db.js';
import { initRates } from './services/rates.js';
import { createApp } from './app.js';

db.load();
initRates();
const app = createApp();
app.listen(env.port, () => {
  console.log(`[server] ${db.settings().brand.name} API listening on http://localhost:${env.port}`);
  console.log(`[server] data loaded from ${db.loadedFrom}`);
  if (env.demoMode) console.log(`[server] demo mode: login with mobile 9999999999 and OTP ${env.demoOtp}`);
});
