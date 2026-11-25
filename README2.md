# MernProject - Technical Reference

This document describes the current implementation in this repository. It is based on source files, route registrations, package manifests, environment templates, Docker configuration, and CI configuration; it does not treat older notes or legacy routers as current behavior.

## 1. Project Overview

MernProject is a Pure MERN application for selling, exchanging, browsing, and purchasing mobile devices. The repository contains three runtime applications:

- `client/`: React 18 storefront at the default development port `5173`.
- `admin/`: React 18 administration dashboard at the default development port `5174`.
- `server/`: Node.js 18+ and Express REST API on port `4000`.

MongoDB is the primary persistent data store. Redis and BullMQ are optional infrastructure for queued jobs. Cloudinary is optional in development and mandatory for application uploads in production. The legacy `server/src/ml/` and external `ml-service` area in Docker Compose are not the source of truth for ordinary pricing; the live Node pricing service first attempts an HTTP ML-service call and otherwise uses a rule-based fallback.

## 2. System Architecture

```text
Browser / Storefront (React/Vite :5173)
        |
        | HTTP + cookie credentials + CSRF header
        v
Express REST API (:4000)
  /api/v1/user, /api/v1/devices, /api/v1/cart,
  /api/v1/orders, /api/v1/payments, /api/v1/pricing, ...
        |
        +--> MongoDB/Mongoose
        |
        +--> Redis/BullMQ (optional notification jobs)
        |
        +--> Cloudinary or local server/uploads
        |
        +--> eSewa ePay v2 status/form APIs

Browser / Admin Dashboard (React/Vite :5174)
        |
        | admin cookie + cookie credentials + CSRF header
        v
Express REST API
  /api/admin/* (with /admin/devices alias)
        |
        +--> MongoDB/Mongoose
```

The backend entry point is `server/server.js`. It is an ES module application (`server/package.json` sets `"type": "module"`) and:

1. Loads environment variables with `dotenv`.
2. Initializes Sentry if `SENTRY_DSN` exists.
3. Installs request IDs, Helmet, compression, `/api/` rate limiting, Mongo/XSS sanitization, CORS, JSON/form parsing, cookies, and logging.
4. Applies CSRF to unsafe methods except explicitly allowed login, recovery, CSRF, eSewa callback, and webhook paths.
5. Registers public/storefront and admin routers.
6. Registers `notFound` and centralized `errorHandler` middleware.
7. Connects to MongoDB, seeds an admin if needed, and starts listening.

Graceful shutdown closes the HTTP listener and Mongoose connection before exiting.

## 3. Repository and Directory Map

### Root

| Path | Purpose |
|---|---|
| `server/` | Express API and Mongoose backend |
| `client/` | React/Vite storefront |
| `admin/` | React/Vite administration dashboard |
| `docker-compose.yml` | Local/container infrastructure and build topology |
| `.github/workflows/ci.yml` | Node 18 CI build workflow |
| `README.md` | Existing project overview |
| `README2.md` | This technical reference |
| `Details.md` | Referenced in the task but not currently present in the repository |
| `AGENTS.md` | Repository engineering rules |
| `debug_cart.js`, `find_test_data.js`, `qa_test.mjs`, and similar root/server scripts | Diagnostic, cleanup, verification, or ad hoc test artifacts |

### `client/src/`

- `App.jsx`: Storefront route table.
- `main.jsx`: React root; mounts to `#cyf-root` or `#root`, then installs React Query, authentication, cart, and router providers.
- `pages/`: Home, buy flow, product detail, cart, checkout, payment success/failure, order pages, sell flow, account/profile, auth recovery, FAQ, reviews, warranty, contact, and 404 views.
- `components/`: Layout, navigation, footer, hero slider, product cards, search UI, reviews, confirmations, payment controls, and route guards.
- `components/ProtectedRoute.jsx`: Redirects unauthenticated storefront users.
- `components/PublicOnlyRoute.jsx`: Redirects authenticated users away from login/register.
- `context/AuthContext.jsx`: Storefront session state and login/register/logout operations.
- `context/CartContext.jsx`: Cart state and mutations.
- `hooks/`: Device, auth-user, and in-view hooks.
- `lib/api.js`: Axios instance, CSRF acquisition, 401 refresh, and normalized errors.
- `lib/queryClient.js`: TanStack Query client configuration.
- `services/`: API wrappers for devices, cart, orders, payments, sell requests, reviews, heroes, and auth recovery.
- `utils/`: API base resolution, image URL helpers, buy-flow storage, and normalization.

### `admin/src/`

- `App.jsx`: Protected admin route table and session check.
- `main.jsx`: React root, React Query provider, and browser router.
- `pages/`: Dashboard, devices, hero slides, reviews, sell requests, pricing, FAQs, orders, users, user detail, login, and 404.
- `components/`: Shell/sidebar/topbar, modals/fields, and payment verification UI.
- `context/AdminStatsContext.jsx`: Shared dashboard statistics state.
- `lib/api.js`: Admin Axios instance with credentials, CSRF headers, API response unwrapping, and 401 login redirect.
- `lib/auth.js`: Small browser-side auth-state marker.
- `lib/constants.js`: API URL resolution.
- `lib/upload.js`: Upload helpers.
- `services/`: Admin notifications, users, and order API operations.

### `server/src/`

- `config/`: MongoDB connection and production environment validation.
- `models/`: Mongoose schemas and relationships.
- `routes/`: Mountable route groups, including public APIs and admin APIs.
- `modules/`: Modular implementations for user, device, order, payment, and pricing.
- `controllers/`: HTTP handlers and response formatting.
- `services/`: Domain logic for carts, orders, payments, sell requests, notifications, analytics, and optional ML pricing.
- `middleware/`: Authentication, admin RBAC, CSRF, audit, validation, sanitization, upload, caching, request IDs, logging, and rate limiting.
- `validators/`: Zod schemas for legacy/device/user/order/review validation.
- `utils/`: Cloudinary/local image storage, image URL normalization, search, logger, async handling, and application errors.
- `queues/index.js`: Optional BullMQ queue construction.
- `workers/notifications.worker.js`: Optional notifications worker.
- `scripts/`: Admin seeding and controlled admin startup seeding.
- `ml/`: Legacy/stale Python-style artifacts; they are not part of the Pure MERN application architecture.

## 4. Database Schemas and Relationships

### `User`

Primary storefront account.

- Key fields: `name`, sparse/unique `email`, required unique `phone`, `passwordHash`, role, `isVerified`, timestamps.
- Role enum: `user`, `admin`, `staff`; default `user`.
- `refreshTokens[]`: SHA-256 token hash, creation/expiry/last-used/revocation timestamps, user agent, and IP.
- Password recovery: reset token hash/expiry and OTP hash/expiry/attempt count.
- Relationships: owns one `Cart`, creates `Order` documents, submits `SellRequest` and `ProductReview` documents, and is referenced by payment/session workflows through orders.
- Indexes: unique/sparse email, unique phone, role, timestamps via Mongoose.

### `AdminUser`

Separate administration account model.

- Key fields: unique lowercase `email`, `passwordHash`, `role`, `disabled`, timestamps.
- Role enum: `owner`, `admin`, `manager`, `support`, `fulfillment`, `readonly`.
- No admin account is logged in through the storefront `User` model.
- Referenced by `AuditLog` and `ProductReview.approvedBy`.

### `Device`

Catalog/product model.

- Key fields: `name`, unique `slug`, `brand`, `price`, `quantity`, `feature`, `condition`, `availability`, `featured`, `images[]`, `thumbnail`, `description`, timestamps.
- Condition enum: `new`, `like_new`, `pre_owned`, `refurbished`.
- Availability enum: `in_stock`, `out_of_stock`, `coming_soon`.
- Pre-validation normalizes condition/availability, forces `out_of_stock` at quantity zero, creates an initial slug, and resolves slug collisions by suffixing.
- Indexes: unique slug, text search across name/brand/feature/description, featured plus created date, brand/price, condition/availability/price/created date, and created date.
- Relationships: referenced by cart items and order item snapshots.

### `Cart`

Exactly one cart per authenticated user.

- `user`: unique required `User` reference.
- `items[]`: embedded subdocuments with `Device` reference, optional `variant` (`storage`, `color`, `condition`), quantity `1..5`, and `priceSnapshot`.
- `lastUpdatedAt` and `lastSeenAt` support unread/changed-cart state.
- The subdocument `_id` is the cart line identifier used by PATCH/DELETE item endpoints.

### `CheckoutSession`

Temporary eSewa checkout-from-cart snapshot.

- Fields: required `User` reference, contact object, arbitrary item array, `total`, currency, status.
- Status enum: `pending`, `completed`.
- A TTL index removes sessions after 86,400 seconds (24 hours).
- On successful eSewa verification it becomes a paid `Order` and `Payment` and is marked completed.

### `Order`

Persistent purchase record.

- `orderNumber`: unique sequential identifier such as `CYP-YYYYMMDD-000001`.
- `user` reference, contact snapshot, embedded item snapshots, currency, total, status, `paymentStatus`, timestamps.
- Item snapshot fields: product reference, name, condition, price, quantity, and thumbnail.
- Status enum: `created`, `processing`, `shipped`, `completed`, `cancelled`.
- Payment-status enum: `unpaid`, `paid`, `refunded`.
- Indexes: user/created date, status/created date, payment status/created date, and created date.
- Relationship: each order can have payment records, including succeeded-payment uniqueness.

### `Payment`

Provider payment attempt and result.

- Fields: required `Order` reference, provider, `transactionUuid`, `esewaRefId`, amount/currency, status, raw callback object, attempts, timestamps, and reference.
- Provider enum: `khalti`, `esewa`, `bank`.
- Status enum: `initiated`, `succeeded`, `failed`, `cancelled`.
- For eSewa initiated payments, `transactionUuid` is normally the `Payment` `_id`.
- Checkout-session initiation uses the `CheckoutSession._id` as transaction UUID instead.
- Indexes: order/created date, status/created date, transaction UUID, and a unique partial index allowing only one succeeded payment per order.

### `SellRequest`

Sell/exchange request submitted by a storefront user.

- Optional `User` reference, `isGuest`, contact details, `deviceName`, condition, expected/suggested/ML price fields, confidence, notes, images, status, request type, deletion flag, timestamps.
- Condition enum: `new`, `like_new`, `refurbished`, `pre_owned`.
- Status enum includes legacy and workflow values: `new`, `contacted`, `closed`, `CREATED`, `PAYMENT_PENDING`, `PAID`, `VERIFIED`, `COMPLETED`, `REJECTED`.
- Request type: `sell` or `exchange`.
- Index: `isDeleted + status + createdAt`.
- The service enforces a separate transition map, and the public submit route currently creates `isGuest: false` because it requires authentication.

### `ProductReview`

Device review tied to an authenticated user.

- Required `User` reference, optional `Device` reference, rating `1..5`, title, comment, moderation status, approving admin, approval date, timestamps.
- Status enum: `pending`, `approved`, `rejected`.
- Unique partial index on `userId + productId` when `productId` exists, preventing duplicate per-product reviews.

### `Review`

General customer testimonial, independent of a product.

- Key fields: name, designation, rating, message, avatar, status, legacy `active` flag, timestamps.
- Status enum: `pending`, `approved`, `rejected`; default `pending`.
- `active` is kept synchronized conceptually: approved means active, pending/rejected means inactive.
- Compound index: status, active, created date.

### `HeroSlide`

Homepage CMS slide.

- Key fields: title, subtitle, CTA text/link, legacy `image`, desktop `imageDesktop`, mobile `imageMobile`, order, active, timestamps.
- `image` is required and is set/kept as a desktop-image fallback where appropriate.
- Compound index: active plus order.

### `Faq`

FAQ content.

- Key fields: question, answer, category, order, `isActive`, timestamps.
- Compound index: `isActive + order`.

### `GlobalConfig`

Loose key/value configuration.

- `key`: unique required string.
- `value`: Mixed Mongoose value.
- The current pricing implementation stores `pricing_config` with `weights`, `useML`, and `margin`.

### `AuditLog`

Immutable-oriented administrative action trail.

- References `AdminUser` and stores actor email/role snapshots.
- Fields include action, HTTP method/path, entity type/id, sanitized request body, status code, request ID, IP, user agent, timestamps.
- Indexed by actor/action/entity/request and created date.
- TTL index removes logs after 90 days.

### `AdminNotification`

Admin notification queue/data record.

- Fields: uppercase type, entity model/id, message, read timestamp, timestamps.
- Unique compound index on `(type, entityId)` prevents duplicate notifications for the same entity.

### `Counter`

Sequential order-number counter.

- `_id` identifies the counter, normally `order`.
- `seq` increments atomically inside transactions.

## 5. Mounted API Reference

The following routes are mounted in `server/server.js`. Prefixes and middleware are the current implementation.

### Health and readiness

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | API limiter and global middleware | DB state, process uptime, timestamp |
| `GET` | `/api/ready` | API limiter and global middleware | Returns 503 unless MongoDB is connected |

### Storefront CSRF

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/csrf` | API limiter; sets non-HttpOnly cookie | Returns a 32-byte hex CSRF token |

### Storefront user authentication and profile

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/user/register` | Auth limiter, Zod validation | Register by name, phone, optional email, password |
| `POST` | `/api/v1/user/login` | Auth limiter, Zod validation | Login with email or phone and password |
| `POST` | `/api/v1/user/forgot-password` | Auth limiter, Zod validation | Initiate password recovery |
| `POST` | `/api/v1/user/reset-password` | Auth limiter, Zod validation | Reset password |
| `POST` | `/api/v1/user/refresh` | Public refresh cookie; CSRF by global middleware | Rotate refresh token and issue access/refresh cookies |
| `POST` | `/api/v1/user/logout` | Public refresh/access cookie usage | Clear auth cookies and revoke current session where implemented |
| `GET` | `/api/v1/user/me` | `authUser` | Return current storefront user |
| `PATCH` | `/api/v1/user/me` | `authUser`, Zod update validation | Update profile |

### Devices/catalog

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/devices` | Optional auth, query validation | Filter/search/paginate devices |
| `GET` | `/api/v1/devices/:id` | Optional auth | Retrieve a device |
| `GET` | `/api/v1/devices/:id/recommendations` | Public | Device recommendations |

### Hero slides and FAQs

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/hero-slides` | Brief cache | Public hero slides |
| `GET` | `/api/v1/faqs` | Brief cache | Active FAQs ordered for display |

### Reviews

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/reviews` | Public | List approved/active customer testimonials |
| `POST` | `/api/v1/reviews` | Review limiter, upload avatar, Zod validation | Submit testimonial (moderation required) |
| `GET` | `/api/v1/product-reviews` | Public | List approved product reviews |
| `POST` | `/api/v1/product-reviews` | `authUser` | Submit product review |

### Cart

Every route is behind `authUser`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/cart` | Get shaped cart, line IDs, total, unread state, price/stock/deletion flags |
| `POST` | `/api/v1/cart/items` | Add or merge a device/variant line |
| `PATCH` | `/api/v1/cart/items/:id` | Update quantity by cart line `_id` (legacy device `_id` fallback) |
| `DELETE` | `/api/v1/cart/items/:id` | Remove cart line (legacy device `_id` fallback) |
| `DELETE` | `/api/v1/cart` | Clear cart |
| `POST` | `/api/v1/cart/mark-seen` | Mark cart as seen |
| `POST` | `/api/v1/cart/sync-prices` | Refresh cart price snapshots from current devices |

Guest-cart merge routes are not mounted or implemented in the current cart router.

### Orders

Every route is behind `authUser`.

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/orders/from-cart` | Zod validation | Atomically create unpaid order from cart and reserve inventory |
| `GET` | `/api/v1/orders/mine` | `authUser` | Current user's orders |
| `GET` | `/api/v1/orders/:id` | `authUser` | Order detail with user ownership check |
| `POST` | `/api/v1/orders/:id/cancel` | `authUser` | Cancel a `created` order and restore inventory |

### Sell/exchange requests

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/sell-requests/my` | `authUser` | List owned sell/exchange requests |
| `POST` | `/api/v1/sell-requests` | `authUser`, up to five image uploads | Submit request; estimate price when matching device exists |

### Pricing

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/pricing/config` | Public; global middleware | Return the pricing configuration |
| `POST` | `/api/v1/pricing/estimate` | Zod validation | Rule/optional-ML price estimate |

### eSewa payment routes

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/payments/esewa/success` | Public redirect; payment callback CSRF exception | Redirect browser to storefront success view while carrying encoded data |
| `POST` | `/api/v1/payments/esewa/success` | Public callback; payment callback CSRF exception | Same callback handling for provider POST redirects |
| `GET` | `/api/v1/payments/esewa/failure` | Public redirect; callback CSRF exception | Mark/carry failure and redirect to storefront checkout |
| `GET` | `/api/v1/payments/verify/esewa` | Payment limiter | Decode, verify signature, query eSewa status, create/update payment/order |
| `POST` | `/api/v1/payments/esewa/initiate` | Payment limiter, `authUser`, Zod validation | Initiate payment for an existing order |
| `POST` | `/api/v1/payments/esewa/initiate-checkout` | Payment limiter, `authUser`, Zod checkout validation | Snapshot cart/contact, initiate checkout-session payment |
| `POST` | `/api/v1/payments/admin/verify/:id` | `authUser` plus user/admin check, CSRF | Admin/manual eSewa status verification |

### Admin authentication

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `POST` | `/api/admin/auth/login` | Strong login limiter | Separate `AdminUser` login and `admin_token` cookie |
| `GET` | `/api/admin/auth/me` | `requireAdmin` | Return current admin identity |
| `POST` | `/api/admin/auth/logout` | `requireAdmin`, CSRF | Clear admin cookie |

### Admin devices

Mounted at `/api/admin/devices` (with `/admin/devices` retained as a backward-compatibility alias).

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/devices` | `requireAdmin` | List devices |
| `GET` | `/api/admin/devices/:id` | `requireAdmin` | Device detail |
| `POST` | `/api/admin/devices` | `requireAdmin`, thumbnail/images multipart, Zod validation | Create device |
| `PUT` | `/api/admin/devices/:id` | `requireAdmin`, multipart, Zod validation | Replace/update device |
| `PATCH` | `/api/admin/devices/:id` | `requireAdmin`, multipart, Zod validation | Patch device |
| `DELETE` | `/api/admin/devices/:id` | `requireAdmin` | Delete device |

### Admin hero slides

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/hero` | `requireAdmin` | List/admin inspect slides |
| `GET` | `/api/admin/hero/:id` | `requireAdmin` | Slide detail |
| `POST` | `/api/admin/hero` | Role `owner/admin/manager`, audit, responsive upload fields | Create slide |
| `PATCH` | `/api/admin/hero/:id` | Role `owner/admin/manager`, audit, responsive upload fields | Update slide |
| `DELETE` | `/api/admin/hero/:id` | Role `owner/admin`, audit | Delete slide |

### Admin reviews

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/reviews` | `requireAdmin`; role owner/admin/manager/support | List testimonials |
| `GET` | `/api/admin/reviews/:id` | Same role set | Testimonial detail |
| `POST` | `/api/admin/reviews` | Role owner/admin/manager, audit, avatar upload | Create testimonial |
| `PATCH` | `/api/admin/reviews/:id` | Role owner/admin/manager, audit, avatar upload | Update/moderate testimonial |
| `DELETE` | `/api/admin/reviews/:id` | Role owner/admin, audit | Delete testimonial |

### Admin product reviews

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/product-reviews` | `requireAdmin` | List product reviews |
| `PATCH` | `/api/admin/product-reviews/:id` | Role owner/admin/manager, audit | Approve/reject/update product review |

### Admin orders

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/orders` | `requireAdmin`; role owner/admin/manager/support/fulfillment | List orders |
| `GET` | `/api/admin/orders/:id` | Same role set | Order detail |
| `PATCH` | `/api/admin/orders/:id/status` | Role owner/admin/manager/fulfillment, audit | Change order status |

### Admin sell requests

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/sell-requests` | `requireAdmin`; role owner/admin/manager/support/fulfillment | List sell requests |
| `GET` | `/api/admin/sell-requests/:id` | Same role set | Sell-request detail |
| `PATCH` | `/api/admin/sell-requests/:id/status` | Role owner/admin/manager/fulfillment, audit | Transition status |
| `DELETE` | `/api/admin/sell-requests/:id` | Role owner/admin, audit | Soft delete/remove request |

### Admin users

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/users` | `requireAdmin`; role owner/admin/manager/support | List users |
| `GET` | `/api/admin/users/:id` | Same role set | User detail |

### Admin FAQ

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/faqs` | `requireAdmin` | List FAQs for administration |
| `POST` | `/api/admin/faqs` | Role owner/admin/manager, audit | Create FAQ |
| `PUT` | `/api/admin/faqs/:id` | Role owner/admin/manager, audit | Replace/update FAQ |
| `PATCH` | `/api/admin/faqs/reorder` | Role owner/admin/manager, audit | Reorder FAQs |
| `DELETE` | `/api/admin/faqs/:id` | Role owner/admin, audit | Delete FAQ |

### Admin pricing

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/pricing/config` | `requireAdmin` | Read `GlobalConfig.pricing_config` |
| `PATCH` | `/api/admin/pricing/config` | `requireAdmin`, CSRF | Update weights, ML toggle, margin |

### Admin uploads

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `POST` | `/api/admin/upload/single` | `requireAdmin`; role owner/admin/manager; audit; multipart `file` | Upload one CMS file |
| `POST` | `/api/admin/upload/many` | Same roles; audit; multipart `files`, max 10 | Upload multiple CMS files |

### Admin notifications

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/notifications` | `requireAdmin` | List notifications |
| `GET` | `/api/admin/notifications/summary` | `requireAdmin` | Notification summary |
| `POST` | `/api/admin/notifications/read` | `requireAdmin`, CSRF | Mark bulk notification set read |
| `POST` | `/api/admin/notifications/:id/read` | `requireAdmin`, CSRF | Mark one notification read |
| `POST` | `/api/admin/notifications/read-all` | `requireAdmin`, CSRF | Mark all notifications read |
| `POST` | `/api/admin/notifications/read-by-type` | `requireAdmin`, CSRF | Mark notifications of a type read |

### Admin stats and analytics

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/stats` | `requireAdmin` | Dashboard summary metrics |
| `GET` | `/api/admin/analytics/dashboard` | `requireAdmin` | Full analytics dashboard data |

### Admin payments and audit

| Method | Path | Auth/middleware | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/payments` | `requireAdmin` | List payments |
| `GET` | `/api/admin/payments/:id` | `requireAdmin` | Payment detail |
| `GET` | `/api/admin/audit` | `requireAdmin`; role owner/admin/manager/support | Audit logs |

## 6. Authentication and Security Workflows

### Storefront authentication

Storefront users log in by email or phone. Passwords use bcrypt with 12 cost. Successful login/registration creates:

- HTTP-only `access_token` cookie, 15-minute lifetime.
- HTTP-only `refresh_token` cookie, 30-day lifetime, scoped to `/api/v1/auth/refresh` in the current controller.
- A SHA-256 hash of the refresh token stored in `User.refreshTokens[]`.

Note: the runtime mount for refresh is `/api/v1/user/refresh`, while `setAuthCookies()` currently scopes the refresh cookie to `/api/v1/auth/refresh`. This is a real mismatch: for browser requests at `/api/v1/user/refresh`, the refresh cookie may not be sent if cookie path scoping is enforced by the browser. Treat this as a cleanup item unless runtime/header behavior has been separately corrected.

The access secret is `JWT_ACCESS_SECRET`, falling back to `JWT_SECRET` in middleware. The refresh secret is `JWT_REFRESH_SECRET`. Refresh verifies the refresh JWT, finds the user, matches the SHA-256 hash, rotates the old record to `revokedAt`, and adds a new session record. Up to five active sessions are retained by default (`MAX_REFRESH_SESSIONS`, default `5`).

The Axios storefront interceptor:

- Gets `/api/v1/csrf` and caches the token.
- Adds `x-csrf-token` for unsafe HTTP methods.
- Refreshes the CSRF token once on a CSRF 403.
- Calls `/api/v1/user/refresh` once on 401 and retries the original request.

Storefront `authUser` accepts access tokens from `access_token`, `accessToken`, or a bearer header, verifies it, and reloads the user from MongoDB on every request. It rejects disabled/inactive users.

### Admin authentication

Admin users use `AdminUser` and a separate `admin_token` HTTP-only JWT cookie. The JWT expires after two hours and uses `ADMIN_JWT_SECRET`. `requireAdmin` verifies the cookie and reloads the `AdminUser`; disabled or missing accounts are rejected. Production admin cookies use `secure` and `sameSite=none`; development uses `secure=false` and `sameSite=lax`.

Admin routes then apply role matrices through `requireAdminRole`. Audit middleware records mutating CMS actions where attached to routes.

### CSRF

The backend has a global unsafe-method CSRF gate. A browser obtains a random token from `GET /api/v1/csrf`; the server sets a readable `csrf_token` cookie and the frontend sends the same value in `x-csrf-token`. The gate compares cookie and header values. It bypasses CSRF for CSRF token retrieval, login/register, password recovery, eSewa success/failure callbacks, and webhook-style paths that perform provider verification themselves.

### Sanitization and rate limiting

- Request IDs are added by middleware.
- Express Mongo sanitize and sanitize-html/XSS middleware are installed globally.
- `/api/` receives the general IP-plus-user limiter (`RATE_LIMIT_WINDOW_MS`, default 60 seconds; `RATE_LIMIT_MAX`, default 300).
- Auth endpoints use a stricter limiter capped at 30 requests.
- Admin login allows 5 attempts per 15 minutes by default or `ADMIN_LOGIN_RATE_LIMIT_MAX`.
- Review creation allows 10 per 10 minutes by default.
- Payment attempts allow 10 per minute.

## 7. Cart, Checkout, and eSewa Flow

### Cart workflow

All cart operations require a storefront authenticated session. One `Cart` with a unique `user` field is used per account. Items carry a product reference, optional variant keys, quantity, and price snapshot.

The cart response:

- Uses the cart-line `_id` as `id` and the device `_id` as `deviceId`.
- Calculates line totals from snapshot price and quantity.
- Reports out-of-stock, deleted product, price-change, and unread flags.
- Enforces a maximum quantity of five per line.
- Checks aggregate quantity across repeated lines against `Device.quantity`.

### Direct order checkout

`POST /api/v1/orders/from-cart` starts a MongoDB transaction:

1. Load the user's cart.
2. Reload referenced devices.
3. Reject missing/deleted, out-of-stock, insufficient-stock, and changed-price items.
4. Atomically decrement `Device.quantity` with `$gte` and `$inc` guards.
5. Generate a sequential `CYP-YYYYMMDD-NNNNNN` order number from `Counter`.
6. Create an order with `status=created` and `paymentStatus=unpaid`.
7. Clear the cart and create an admin notification.
8. Commit or abort atomically.

User cancellation is only allowed for `created` orders. Cancellation restores stock in one transaction and changes status to `cancelled`.

### eSewa ePay v2 initiation

There are two eSewa initiation forms:

- Existing order: creates/cancels payment attempts and signs the order's total.
- Checkout from cart: validates current device availability/prices, creates a 24-hour `CheckoutSession`, and signs the session total.

The initiation fields include `amount`, `tax_amount=0`, `total_amount`, `transaction_uuid`, `product_code`, zero charges, success/failure URLs, signed field names, and an HMAC-SHA256 Base64 signature.

The signed message format is:

```text
total_amount=<amount>,transaction_uuid=<uuid>,product_code=<product-code>
```

The server uses `ESEWA_SECRET_KEY` with `crypto.createHmac("sha256", secret).digest("base64")`.

### Verification and idempotency

The frontend calls `GET /api/v1/payments/verify/esewa?data=<base64>` after callback success. The backend:

1. Base64-decodes and parses the provider payload.
2. Rebuilds and compares the eSewa callback signature over `signed_field_names`.
3. Uses the transaction UUID to find either a `Payment` or `CheckoutSession`.
4. Requeries eSewa's status API using product code, total amount, and transaction UUID.
5. Requires provider status `COMPLETE`.
6. Uses a MongoDB transaction for final state changes.

Idempotency exists in both branches:

- A succeeded `Payment` returns immediately.
- A completed `CheckoutSession` searches for and returns the existing payment/order.
- The database also has a unique partial index for one succeeded payment per order.

For an existing order, verification marks `Payment` succeeded, `Order` paid/processing, and clears the cart. For a checkout session, verification creates a sequential order, creates a succeeded payment, marks the session completed, and clears the cart. Both branches create an admin notification for a session-created order.

The direct-order branch decrements inventory during order creation; the checkout-session branch relies on session snapshots and does not appear to run a second inventory decrement during eSewa verification, so the session and direct-order flows have different stock timing.

## 8. Rule-Based Price Estimation and Sell/Exchange Flow

### Pricing

`GlobalConfig.pricing_config` supplies optional `weights`, `useML`, and `margin`. The service defaults to:

- `brand_new: 1.0`
- `like_new: 0.9`
- `good: 0.8`
- `fair: 0.7`
- `broken: 0.4`
- `margin: 0.10`
- `useML: true`

There is a mismatch in condition vocabulary:

- `SellRequest` and `Device` use `new`, `like_new`, `refurbished`, and `pre_owned`.
- The live ML service sanitizes `brand_new`, `like_new`, `good`, `fair`, and `broken`.
- The rule fallback normalizes service conditions into keys and may fail if no weight is found.

The admin pricing defaults/controller use catalog-style weights for `new`, `like_new`, `refurbished`, and `pre_owned`; the pricing service fallback still uses older brand-condition names. Consequently, naming/condition alignment is an important cleanup area.

When ML is enabled, `estimateDeviceValue()` calls `MLService.predictPrice()`. The Node ML client posts to `ML_SERVICE_URL/predict-price` with a 2-second timeout and sanitizes/clamps input. `MLService` internally falls back to a rule value if the external service is unavailable or invalid. The outer pricing service applies `1 - margin` to the ML result; rule fallback applies base price × condition weight × `(1 - margin)`, and floors the result.

### Sell/exchange workflow

Authenticated users submit sell/exchange requests with optional five-image multipart upload. The service:

1. Finds a catalog `Device` whose name exactly matches case-insensitively.
2. Estimates price with catalog base price and normalized condition.
3. Stores expected, suggested, ML price, confidence, contact data, images, and `status=new`.
4. Creates an admin notification.

The status transition map is:

- `new` → `contacted`, `closed`, `PAYMENT_PENDING`, `REJECTED`
- `contacted` → `closed`, `PAYMENT_PENDING`, `REJECTED`
- `CREATED` → `PAYMENT_PENDING`, `REJECTED`
- `PAYMENT_PENDING` → `PAID`, `REJECTED`
- `PAID` → `VERIFIED`, `REJECTED`
- `VERIFIED` → `COMPLETED`, `REJECTED`
- `closed`, `COMPLETED`, `REJECTED` → none

Admin status updates enforce the transition map, while direct admin deletion is soft-delete behavior in the controller/model lifecycle.

## 9. Image Upload Pipeline

Both storefront/admin upload middleware use Multer memory storage:

- Accepted MIME types/extensions: JPEG/JPG, PNG, and WEBP.
- Maximum file size: 5 MB per file.
- A magic-byte check using `file-type` verifies actual decoded content before storage.
- Filenames are generated as `<fieldname>-<UUID>.<detected-extension>`.

In `UPLOAD_MODE=local`:

- Files are written under `server/uploads/<folder>/`.
- Relative URL strings are created and later normalized to absolute URLs by `toPublicUploadUrl()`.
- Local `/uploads` static hosting is enabled only outside production.

In `UPLOAD_MODE=cloudinary`:

- Cloudinary is configured from cloud name, API key, and API secret.
- Files are uploaded to `<CLOUDINARY_FOLDER>/<folder>`.
- Uploads force WebP, automatic quality, and automatic browser fetch format.
- The secure Cloudinary URL is stored.

Production startup throws if production is using local uploads. Upload folders include devices, sell, reviews, hero, and admin CMS/general destinations.

## 10. Frontend Architecture

### Storefront

- Vite/React 18 SPA with React Router 6.
- TanStack React Query wraps the app.
- `AuthProvider` and `CartProvider` expose app-wide session/cart state.
- `BrowserRouter` provides browser history routing.
- The mount also supports WordPress embedding by mounting to `#cyf-root` first and Vite's `#root` second, retrying until a host element appears.
- Storefront routes include home, buy condition, warranty, contact, product detail, FAQ, reviews, protected sell/account/request/password/cart/checkout/order/payment routes, auth recovery, and 404.
- Protected routes check auth state.
- Public-only routes keep logged-in users from login/register pages.

`API_BASE_URL` resolution:

- Production requires `VITE_API_URL`.
- Development uses `VITE_API_URL` if present, otherwise `http://<current-hostname>:4000`.
- Docker/CI build inject `VITE_API_URL` as a Vite build argument.

### Admin

- Vite/React 18 SPA with React Router 6 and TanStack Query.
- The app verifies `/api/admin/auth/me` before rendering protected pages.
- Routes cover dashboard, hero slides, devices, testimonials, sell requests, pricing, FAQs, orders, users/detail, and 404.
- `AdminStatsProvider` supplies shared dashboard statistics.
- Admin local storage is used only as a session hint (`isAuthed`); server cookie verification is authoritative.
- `VITE_ADMIN_API_URL` is preferred, with `VITE_API_BASE_URL` and `VITE_API_URL` as fallbacks.
- In production, the admin build fails if no API URL is available; development falls back to `http://localhost:4000`.

## 11. Environment Variables

No real secrets are included below.

### Server

| Variable | Default/behavior | Required |
|---|---|---|
| `NODE_ENV` | `development` | No |
| `PORT` | `4000` | No |
| `MONGO_URI` | No template default | Production: yes |
| `JWT_SECRET` | Legacy fallback for access and other JWT use | Production fallback if split secrets are absent |
| `JWT_ACCESS_SECRET` | Falls back to `JWT_SECRET` in some middleware | Recommended production |
| `JWT_REFRESH_SECRET` | No default in auth controller | Recommended production |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | No |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | No |
| `ADMIN_JWT_SECRET` | No default | Yes in production |
| `CORS_ORIGINS` | Comma-separated origins; empty means allow dev origins or fail prod | Production recommended |
| `UPLOAD_MODE` | `local` | Production must be `cloudinary` |
| `LOCAL_UPLOAD_ROOT` | `uploads` template field; actual code uses `uploads/<folder>` | No |
| `CLOUDINARY_CLOUD_NAME` | None | Cloudinary mode: yes |
| `CLOUDINARY_API_KEY` | None | Cloudinary mode: yes |
| `CLOUDINARY_API_SECRET` | None | Cloudinary mode: yes |
| `CLOUDINARY_FOLDER` | `cashyourphone` | No |

The existing MongoDB database name (`cashyourphone`) and Cloudinary folder are intentionally retained. Changing either may make existing local database records or previously uploaded assets appear missing; migrate those resources deliberately before changing these values.
| `RUN_SEED` | `false`; startup seed behavior uses separate helper | No |
| `ADMIN_EMAIL` | For controlled seed | Seed only |
| `ADMIN_PASSWORD` | For controlled seed | Seed only |
| `RATE_LIMIT_WINDOW_MS` | `60000` | No |
| `RATE_LIMIT_MAX` | `300` | No |
| `ADMIN_LOGIN_RATE_LIMIT_MAX` | `5` in limiter; template example says `10` | No |
| `REVIEW_RATE_LIMIT_WINDOW_MS` | `600000` | No |
| `REVIEW_RATE_LIMIT_MAX` | `10` | No |
| `MAX_REFRESH_SESSIONS` | `5` | No |
| `COOKIE_DOMAIN` | Undefined/current host | No |
| `COOKIE_SAMESITE` | `lax` | No |
| `COOKIE_SECURE` | Production-derived unless explicitly set | No |
| `CLIENT_APP_URL` | `http://localhost:5173` in payment code | Production: yes, unless `FRONTEND_URL` set |
| `FRONTEND_URL` | Fallback for client URL | Production fallback |
| `ESEWA_PRODUCT_CODE` | `EPAYTEST` | No for UAT |
| `ESEWA_SECRET_KEY` | No real default | Production and initiation: yes |
| `ESEWA_FORM_URL` | eSewa UAT v2 form URL | No |
| `ESEWA_STATUS_BASE_URL` | eSewa UAT status URL | No |
| `SERVER_PUBLIC_URL` | `http://localhost:4000` in payment config | Production: yes |
| `SENTRY_DSN` | Undefined | No |
| `REDIS_URL` | Undefined | Optional with jobs |
| `JOBS_ENABLED` | `false` unless exactly `true` | No |
| `ML_SERVICE_URL` | `http://localhost:8000` | No |
| `CACHE_TTL_HERO` | `60` seconds | No |
| `CACHE_TTL_FAQ` | `120` seconds | No |
| `AUTH_DEBUG` | `false` unless exactly `true` | No |

The production validator additionally requires MongoDB, admin JWT secret, JWT access/refresh or a sufficiently strong legacy JWT secret, eSewa secret, public server URL, and client app/front-end URL. Production also rejects local upload mode.

### Storefront build variables

| Variable | Default/behavior |
|---|---|
| `VITE_API_URL` | Required in production; inferred from current hostname in development |
| `VITE_API_PROXY_TARGET` | Vite dev-server proxy target; falls back to `VITE_API_URL`, then `http://localhost:4000` |

### Admin build variables

| Variable | Default/behavior |
|---|---|
| `VITE_ADMIN_API_URL` | Preferred admin API URL |
| `VITE_API_BASE_URL` | Intermediate fallback |
| `VITE_API_URL` | Final fallback |
| `VITE_API_PROXY_TARGET` | Vite proxy target; fallback chain mirrors API constants |

## 12. NPM Scripts and Entry Points

### Server

| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | `node --watch server.js` | Watch server entry |
| `npm start` | `node server.js` | Production/start command |
| `npm run seed` | `node seeds/seed.js` | Seed catalog/demo data |
| `npm run seed:admin` | `node src/scripts/seedAdmin.js` | Seed admin account |

Server entry: `server/server.js`. Native ES modules are enabled by `"type": "module"`.

### Storefront

| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | `vite` | Development server |
| `npm run build` | `vite build` | Production build |
| `npm run preview` | `vite preview` | Preview build |

Default package declared dependencies include React 18, React Router 6, TanStack Query, Axios, Tailwind/PostCSS, Lucide/React Icons, Framer Motion, Swiper, Skeleton, and React Hot Toast.

### Admin

| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | `vite --port 5174` | Development server |
| `npm run build` | `vite build` | Production build |
| `npm run preview` | `vite preview --port 5174` | Preview build |

## 13. Docker and Container Topology

`docker-compose.yml` defines:

| Service | Image/build | Port | Role |
|---|---|---|---|
| `mongodb` | `mongo:latest` | `27017:27017` | MongoDB, persisted by `mongodb_data` |
| `redis` | `redis:alpine` | `6379:6379` | BullMQ/optional Redis connection |
| `ml-service` | `./server/src/ml` / Dockerfile | `8000:8000` | Legacy external ML container reference |
| `backend` | `./server` / Dockerfile | `4000:4000` | Express API; depends on MongoDB, Redis, and ML service |
| `frontend` | `./client` / Dockerfile | `3000:80` | Nginx-hosted storefront; build arg `VITE_API_URL=http://localhost:4000` |
| `admin` | `./admin` / Dockerfile | `3001:80` | Nginx-hosted admin; build arg `VITE_API_URL=http://localhost:4000` |

Backend Compose environment sets production mode, Mongo URI, Redis URL, ML URL, and port. Secrets are intentionally not listed in Compose and must be supplied externally in a real deployment.

Frontend and admin Dockerfiles use a Node 18 build stage followed by Nginx to serve `dist`. The server Dockerfile uses Node 18 Alpine, sets production and port defaults, and runs `npm start`.

## 14. GitHub Actions CI

`.github/workflows/ci.yml` is named `CI` and runs on pushes/pull requests to `main`.

- Runner: Ubuntu latest.
- Matrix: Node `18.x`.
- Action: checkout `v4`, setup-node `v4` with npm caching.
- Installs server, client, and admin dependencies with `npm ci`.
- Builds both frontend applications.
- Does not currently run backend syntax checks, tests, database seed verification, Docker builds, or lint/type checks.

## 15. Known Technical Debt and Cleanup Notes

1. `Details.md` was referenced by the task but does not exist in the current workspace.
2. Docker Compose still declares an `ml-service` backed by `server/src/ml`, but repository guidance describes no Python/FastAPI service and ordinary pricing is implemented in Node. The Compose reference, ML URL, and stale service may be legacy infrastructure.
3. Pricing condition names are inconsistent: catalog/sell data use `new/like_new/refurbished/pre_owned`, while `ml.service.js` expects `brand_new/like_new/good/fair/broken`, and the default/admin config uses two partly overlapping shapes.
4. The refresh cookie path is inconsistent with the modular mount: cookies are set for `/api/v1/auth/refresh`, but the live router is mounted at `/api/v1/user/refresh`.
5. `ChangePassword.jsx` calls `/api/v1/users/change-password`, but the server mounts modular user routes only at `/api/v1/user` and has no `/api/v1/users` mount. The matching password-change route is not currently part of the mounted API.
6. Admin device routes are mounted at `/api/admin/devices` (matching `/api/admin/*`), with `/admin/devices` preserved as a backward-compatibility alias.
7. Many legacy routers under `server/src/routes/*.js` duplicate modular routers under `server/src/modules/*`, but `server/server.js` does not mount all of them:
   - `routes/auth.routes.js`, `routes/users.routes.js`, `routes/session.routes.js`, `routes/device.routes.js`, `routes/order.routes.js`, `routes/payment.routes.js` are dormant or duplicate legacy implementations.
   - Modular user/device/order/payment routers are the live registrations.
8. Some legacy `server/src/controllers/payment.service.js` and `server/src/services/payment.service.js` files coexist with the live modular payment service in `server/src/modules/payment/payment.service.js`; verify imports before reuse.
9. The notifications worker is a placeholder and does not send email/SMS/WhatsApp. Redis and BullMQ job infrastructure exist, but notification queue startup integration should be audited.
10. Public hero/FAQ caches are process-memory or middleware-level and not Redis-backed; Redis is not used for these caches.
11. Admin route role coverage is uneven: some administrative list/read routes require only `requireAdmin`, while mutating routes use detailed role matrices.
12. The server allows a legacy single `JWT_SECRET` fallback for access verification, while user login/refresh sign with dedicated access/refresh secrets. Dedicated production secrets are recommended.
13. eSewa direct-order and checkout-session flows handle stock differently: direct checkout reserves/decrements stock during order creation; checkout-session stock is checked and snapshotted during initiation but not visibly decremented in the verification transaction.
14. The MongoDB partial unique index enforces one succeeded payment per order, but status callbacks and provider data should be re-tested for concurrent/retry scenarios.
15. The server's `server/src/ml/` area should remain deprecated/unlinked in line with the Pure MERN architecture until explicitly removed.
16. CI does not validate backend startup, Mongoose indexes, payment callback behavior, seed scripts, upload storage, or live Redis/Cloudinary/eSewa integrations.

