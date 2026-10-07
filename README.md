# Kanak Jewellers – Demo Backend API

Node + Express backend for the Kanak Jewellers demo website (jewellery catalogue with WhatsApp ordering, live gold/silver rates, Digi Gold, Swarn Sanchay EMA, Book My Gold, Advance Gold, gift cards, orders).

**No database is required.** All data lives in JSON files under `src/data/` and is loaded into memory on start. Demo actions (buying gold, paying an instalment, placing an order) update the in-memory data and are persisted to `.data/state.json`. The store layer (`src/store/db.js`) is the only thing to replace when moving to MongoDB.

## Quick start

```bash
npm install
cp .env.example .env     # defaults work out of the box
npm run dev              # http://localhost:4000  (auto-restarts on change)
```

| Script | What it does |
|---|---|
| `npm run dev` | Start with file watching |
| `npm start` | Start normally |
| `npm test` | Run the API test suite |
| `npm run reset` | Delete runtime state and go back to the seed data |

## Demo login

| Field | Value |
|---|---|
| Customer mobile | `9999999999` (Priya Sharma, has holdings, EMA plan, booking, advance) |
| Any other mobile | creates a fresh customer |
| OTP | `123456` (demo mode also returns it in the send-otp response) |
| Admin API key | `admin-demo-key` sent as `x-admin-key` header |

## Project layout

```
src/
  index.js            boot: load data, start rate engine, listen
  app.js              express app + route mounting
  config/env.js       environment variables
  store/db.js         in-memory document store with JSON persistence
  store/reset.js      npm run reset
  data/*.json         seed data (settings, products, banners, demo customer...)
  services/           business logic (rates, pricing, payments, digigold, ema, bookGold, advanceGold, orders, giftCards, auth, catalog, transactions)
  routes/             public, auth, account (/me), schemes, commerce, admin
  middleware/         auth (JWT + admin key), validate (zod), error handler
test/api.test.js      end-to-end tests using node:test
```

## Key behaviours

- **Live rates**: a simulated bullion feed ticks every `RATE_TICK_SECONDS` around the base rates in settings. Consume via `GET /api/rates` (poll) or `GET /api/rates/stream` (Server-Sent Events). Admin can publish fixed rates with `POST /api/admin/rates`.
- **Product pricing**: computed at request time from net weight × live rate for the purity + making charge + stone charge + 3% GST. Products can also be `FIXED` price or `ON_CALL` (no price, WhatsApp enquiry only).
- **WhatsApp ordering**: every product carries a ready `whatsappUrl` with a prefilled message. `POST /api/orders/whatsapp-link` builds one for a whole cart.
- **Payments**: a mock gateway with a Razorpay-shaped flow. Create → get checkout payload → `POST /api/payments/:id/confirm` with `outcome: success|failure`. On success the purchase is fulfilled (gold credited, instalment marked paid, rate locked, order confirmed). Swap `src/services/payments.js` for a real gateway later; fulfilment handlers stay the same.
- **Admin API**: generic CRUD on banners, categories, collections, products, faqs, branches plus settings, rates and operational actions. Built for the separate admin panel repo.

See [API.md](API.md) for every endpoint with request and response shapes.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `PORT` | 4000 | |
| `CORS_ORIGIN` | http://localhost:3000 | comma separated, `*` allows all |
| `JWT_SECRET` | change-me | |
| `DEMO_MODE` | true | fixed OTP, OTP echoed in response |
| `DEMO_OTP` | 123456 | |
| `ADMIN_API_KEY` | admin-demo-key | |
| `RATE_TICK_SECONDS` | 30 | |
| `STATE_FILE` | .data/state.json | runtime persistence |

## Brand and theme

Brand name, logo, colours (purple `#4A1942` and cream `#F7EFEA`), WhatsApp number, scheme rules and copy all live in `src/data/settings.json` and are served by `GET /api/config`. The frontend should read theme tokens from there so a rename or recolour needs no code change.
