import fs from 'node:fs';
import { STATE_PATH } from './db.js';
if (fs.existsSync(STATE_PATH)) { fs.rmSync(STATE_PATH); console.log(`Removed ${STATE_PATH}. Seed data will be used on next start.`); }
else console.log('No runtime state found; seed data is already in use.');
