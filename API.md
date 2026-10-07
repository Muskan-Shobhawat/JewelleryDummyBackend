# API Reference

Base URL: `http://localhost:4000/api`

Every response is `{ success: true, data, ...extras }` or `{ success: false, message, errors? }`. Authenticated routes need `Authorization: Bearer <token>`. Admin routes need `x-admin-key: <ADMIN_API_KEY>`. Amounts are in rupees (integers for totals, 2 decimals for breakdowns), gold in grams (3 decimals).

## Public

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/config` | Brand, theme tokens, contact + WhatsApp URL, nav, all scheme configs, demo credentials |
| GET | `/rates` | Current rates: `items[]` (gold24k, gold22k, gold18k, gold14k, silver999 with change/trend), `buy`, `sell`, `updatedAt` |
| GET | `/rates/history?limit=96` | Points for a sparkline |
| GET | `/rates/stream` | SSE; event name `rates`, same payload as `/rates` |
| GET | `/banners?placement=hero\|strip` | Active banners sorted by order |
| GET | `/categories` | With `productCount` |
| GET | `/collections` | Curated collections |
| GET | `/branches` | Showrooms |
| GET | `/faqs?section=` | Sections: `digigold-buy/sell/lease/redeem`, `ema`, `book-gold`, `advance-gold`, `general`. `section=digigold` returns all four digigold sections |
| GET | `/products` | Filters: `category, collection, tag, metal, purity, q, minPrice, maxPrice, inStock, ids, sort(featured\|newest\|price_asc\|price_desc\|name_asc\|popular), page, limit`. Extras: `pagination`, `filters` |
| GET | `/products/home` | `newArrivals, bestSellers, trending, featured, diamondEdit` |
| GET | `/products/:slug` | Product + `price` breakdown + `whatsappUrl` + `similar[]` |
| GET | `/search?q=` | Products, categories, collections, trending searches, WhatsApp fallback link |
| GET | `/contact` | Contact channels, branches |
| POST | `/contact` | `{ name, mobile, email?, subject, message }` creates a ticket |
| GET | `/pages/about`, `/pages/privacy-policy`, `/pages/terms-and-conditions` | Static page content |
| GET | `/orders/track?orderNo=&mobile=` | Public order tracking |
| GET | `/gift-cards/check/:code` | Balance check |

### Product `price` object

```json
{ "mode": "RATE_LINKED", "priceOnCall": false, "ratePerGram": 13569.65, "purity": "22K", "netWeight": 8.2,
  "metalValue": 111271.1, "makingCharge": 12239.8, "stoneCharge": 0, "discount": 0,
  "subtotal": 123510.9, "gst": 3705.33, "gstPct": 3, "total": 127216, "mrp": null }
```
`mode` is `RATE_LINKED`, `FIXED` or `ON_CALL` (then `total` is null and `label` is "Price on call").

## Auth

| Method | Path | Body |
|---|---|---|
| POST | `/auth/send-otp` | `{ mobile }` → `{ expiresInSeconds, isNewUser, demoOtp? }` |
| POST | `/auth/verify-otp` | `{ mobile, otp, name? }` → `{ token, user, isNewUser }` |
| GET | `/auth/me` | Profile with `profileComplete, kycVerified, bankLinked` |
| PATCH | `/auth/me` | `{ name, email, dob, anniversary, gender, language, notificationsEnabled, address }` |
| PUT | `/auth/me/address` | `{ line1, line2, landmark, city, state, pincode }` |
| POST | `/auth/me/kyc` | `{ pan, panName }` (auto-verified in demo) |
| PUT | `/auth/me/bank` | `{ holderName, accountNumber, ifsc, bankName? }` (needed before selling gold) |
| POST | `/auth/logout` | |

## Account (`/me`, auth required)

| Method | Path | Purpose |
|---|---|---|
| GET | `/me/dashboard` | One call for wallet/home: digi gold portfolio, EMA summary, locked bookings, advance balance, recent txns, unread count |
| GET | `/me/wishlist` | Decorated products |
| POST | `/me/wishlist/toggle` | `{ productId }` → `{ inWishlist, wishlist }` |
| DELETE | `/me/wishlist/:productId` | |
| GET | `/me/transactions?type=&status=&page=&limit=` | Extras: `summary { totalTransacted, count, goldAccumulatedGrams }`, `tabs`. `type=DIGI_GOLD` matches all digi types |
| GET | `/me/transactions/:idOrTxnNo` | |
| GET | `/me/interests` | "My Interest" list with product + branch; extras `statuses`, `counts` |
| POST | `/me/interests` | `{ productId, note?, size?, branchId?, channel? }` → also returns `whatsappUrl` |
| DELETE | `/me/interests/:id` | |
| GET | `/me/notifications` | extras `unread` |
| PATCH | `/me/notifications/:id/read` | |
| POST | `/me/notifications/read-all` | |
| POST | `/me/support/tickets` | `{ subject, message, category? }` |
| GET | `/me/support/tickets` | |

## Payments (mock gateway)

Any purchase endpoint returns `payment` (checkout payload):

```json
{ "paymentId": "pay_x", "gateway": "MOCK", "orderId": "order_x", "amount": 2000, "amountPaise": 200000, "currency": "INR",
  "name": "Kanak Jewellers", "description": "Digi Gold 0.131 gm @ ₹14814/gm", "prefill": { "name": "", "contact": "", "email": "" },
  "theme": { "color": "#4A1942" }, "methods": [...], "confirmUrl": "/api/payments/pay_x/confirm" }
```

| Method | Path | Body |
|---|---|---|
| GET | `/payments/:id` | checkout payload + status |
| POST | `/payments/:id/confirm` | `{ outcome: "success"\|"failure", method: "UPI"\|"CARD"\|"NETBANKING"\|"WALLET" }` → `{ payment, result }` where `result` holds the fulfilled object (portfolio, plan, booking, advance, order, card). Idempotent |
| POST | `/payments/webhook` | Shape for a real gateway later |

Frontend flow: call purchase endpoint → show mock checkout UI with the payload → user picks method and "Pay" → call confirm → render `result`.

## Digi Gold

| Method | Path | Body / Query |
|---|---|---|
| GET | `/digi-gold` | config, FAQs, portfolio (if logged in) |
| GET | `/digi-gold/quote?side=buy&amount=1000` or `&grams=0.5` or `side=sell&grams=` | breakdown with GST / payout |
| GET | `/digi-gold/portfolio` | grams, available, leased, invested, currentValue, pnl, leases, recent txns |
| POST | `/digi-gold/buy` | `{ amount }` or `{ grams }` → `{ quote, payment }` |
| POST | `/digi-gold/sell` | `{ grams }` or `{ sellAll: true }` → immediate IMPS payout (bank must be linked) |
| POST | `/digi-gold/lease` | `{ grams, months: 3\|6\|12 }` |
| POST | `/digi-gold/redeem` | `{ type: "COIN"\|"VOUCHER", grams, branchId? }` |

## Swarn Sanchay (EMA)

| Method | Path | Body / Query |
|---|---|---|
| GET | `/ema` | config, FAQs, my plans |
| GET | `/ema/calculate?monthly=10000` | youPay, bonus, totalValue, approx grams, maturity date |
| GET | `/ema/plans` | plans with `installments[]` (`PAID/DUE/UPCOMING/BONUS`), `nextInstallment`, `progressPct` |
| POST | `/ema/enrol` | `{ monthlyAmount, autopay?, autopayMethod?, branchId? }` → `{ plan, calc, payment }` (first instalment) |
| GET | `/ema/plans/:id` | |
| POST | `/ema/plans/:id/pay` | `{ installment? }` → `{ installment, payment }` |
| PATCH | `/ema/plans/:id/autopay` | `{ enabled, method?, vpa? }` |
| POST | `/ema/plans/:id/redeem` | after maturity |

## Book My Gold

| Method | Path | Body / Query |
|---|---|---|
| GET | `/book-gold` | config, branches, FAQs, my bookings |
| GET | `/book-gold/quote?purity=22K&grams=10` | rate, totalValue, advanceAmount, expiresAt |
| GET | `/book-gold/bookings` | `daysLeft` included; expired ones auto-flip |
| POST | `/book-gold/bookings` | `{ purity, grams, branchId?, purpose? }` → `{ quote, booking, payment }` |
| GET | `/book-gold/bookings/:id` | certificate data |
| POST | `/book-gold/bookings/:id/cancel` | refund txn created |

## Advance Gold

| Method | Path | Body / Query |
|---|---|---|
| GET | `/advance-gold` | config, branches, FAQs, summary, contracts |
| GET | `/advance-gold/quote?amount=25000` | |
| GET | `/advance-gold/contracts` | extras `summary { availableBalance, grams, activeContracts }` |
| POST | `/advance-gold/contracts` | `{ amount, method? }` → `{ quote, advance, payment }` |
| GET | `/advance-gold/contracts/:id` | includes `qrPass` |

## Orders and gift cards

| Method | Path | Body |
|---|---|---|
| POST | `/orders/preview` | `{ items:[{productId, qty, size?}], couponCode?, delivery }` → priced cart with coupon result and shipping (no auth needed) |
| POST | `/orders/whatsapp-link` | `{ items }` → `{ text, whatsappUrl }` |
| POST | `/orders` | `{ items, couponCode?, delivery: COURIER\|PICKUP, branchId?, address?, paymentMethod: UPI\|CARD\|NETBANKING\|GOLD_WALLET, notes? }` → `{ order, payment }` (`payment` null for GOLD_WALLET) |
| GET | `/orders`, `/orders/:id` | |
| POST | `/orders/:id/cancel` | |
| GET | `/gift-cards` | config + mine |
| POST | `/gift-cards` | `{ amount, recipientName, recipientMobile, message? }` → `{ payment }`; card issued on confirm |

## Admin (`/admin`, header `x-admin-key`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/stats` | Dashboard numbers |
| GET / PATCH | `/admin/settings` | Full settings document; PATCH deep-merges |
| POST | `/admin/rates` | `{ gold24k?, silver999?, manualOverride? }` publish rates |
| GET | `/admin/:collection?q=&status=&userId=&page=&limit=` | Any collection (content or read-only) |
| GET | `/admin/:collection/:id` | |
| POST / PUT / PATCH / DELETE | `/admin/:collection[/:id]` | Only on `banners, categories, collections, products, faqs, branches` |
| POST | `/admin/:collection/reorder` | `{ ids }` |
| PATCH | `/admin/ops/orders/:id/status` | `{ status, note? }` |
| PATCH | `/admin/ops/interests/:id` | `{ status, quoteAmount?, consultationAt?, branchId?, note? }` |
| POST | `/admin/ops/bookings/:id/redeem` | `{ billNo? }` |
| POST | `/admin/ops/advances/:id/redeem` | `{ billNo?, amountUsed? }` |
| PATCH | `/admin/ops/tickets/:id` | `{ status?, reply? }` |
| POST | `/admin/ops/notifications` | `{ userId\|null, title, body, link?, type? }` |

### Product document (for admin create)

```json
{ "name": "Kaia Layered Chain", "category": "chains", "collections": ["everyday-gold"], "metal": "GOLD", "purity": "22K",
  "pricingMode": "RATE_LINKED", "grossWeight": 8.2, "netWeight": 8.2, "stoneWeight": 0, "stoneCharge": 0, "diamondCarat": 0,
  "makingCharge": { "type": "PCT", "value": 11 }, "discountPct": 0, "fixedPrice": null, "mrp": null,
  "tags": ["new", "trending"], "sizes": [], "images": ["https://..."], "description": "", "highlights": [],
  "certification": "BIS Hallmark 916 (HUID)", "inStock": true, "stockQty": 5, "active": true, "featured": true, "order": 5 }
```
`makingCharge.type` is `PCT` (of metal value), `PER_GRAM` or `FLAT`. `pricingMode` is `RATE_LINKED`, `FIXED` (uses `fixedPrice`, `mrp` for strike-through) or `ON_CALL`.
