# ECOS Changelog — V143: Real Auth + Stripe Live

**Release Date:** 2026-05-30
**Version:** 143.0.0
**Release Name:** Real Auth + Stripe Live (P33)

---

## Overview

V143 delivers P33 — the two highest-leverage items from the V142 recommendation:
**real authentication** (email/password with JWT + refresh tokens) and the
**Stripe live test harness** (full flow validation from key format to validator payout).
Together these unblock the first real revenue within 24–48 hours.

---

## [V143-AUTH-01] Real Auth: Email/Password + JWT + Refresh Tokens

### Before (V142)
Validators logged in via a shared password (`VALIDATOR_LOGIN_PASSWORD`) and received
a long-lived 8-hour JWT. No registration flow, no per-user accounts, no session rotation.

### After (V143)
Full per-user authentication with:

**`lib/authService.js`** — zero external dependencies:
- `register({ email, password, displayName })` — scrypt password hashing (N=16384)
- `login({ email, password })` → `{ accessToken (15m), refreshToken (30d), user }`
- `refresh({ refreshToken })` — token rotation (old revoked → new issued, same family chain)
- `logout({ refreshToken })` — revoke token
- `verifyAccessToken(token)` — decode+verify access JWT

**Security design:**
- Passwords: `crypto.scrypt` (Node built-in, OWASP-recommended params, no bcrypt dep)
- Access JWT: HS256, 15 min, manual implementation (no jsonwebtoken dep)
- Refresh token: 48 random bytes base64url, SHA-256 hashed for storage
- Token rotation: each refresh invalidates the old token
- Reuse detection: revoked token used → entire family revoked (detects session theft)
- In-memory fallback when no DB (dev/test); DB-backed in production

**5 new endpoints:**
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET  /api/v1/auth/me`

**`apps/web/src/app/login/page.jsx`:**
- Sign In + Create Account tabs in one page
- Token stored in `sessionStorage` (XSS protection vs localStorage)
- Redirect to `/dashboard` on success
- Error display for wrong credentials, account locked, network errors

**`db/migration_phase26.sql`:**
- `ecos_users` — per-user accounts
- `auth_refresh_tokens` — token store with rotation + reuse detection
- `stripe_validator_accounts` — Stripe Connect account registry
- `stripe_payout_log` — payout audit trail

---

## [V143-STR-01] Stripe Live Test Harness

**`scripts/stripe-live-test.js`** — validates the full Stripe flow in 7 steps:

1. API key format (`sk_live_...` or `sk_test_...`)
2. Webhook secret format (`whsec_...`)
3. PaymentIntent creation (real Stripe API call when key set)
4. Mock `payment_intent.succeeded` event construction
5. HMAC-SHA256 webhook signature verification + tamper rejection test
6. `fiatLedger.deposit()` — BigInt credit (sacred file untouched ✅)
7. Stripe Connect Transfer to validator account (when `STRIPE_TEST_CONNECT_ACCOUNT` set)

**Runs in mock mode when no API key set** — safe for CI.

**New npm scripts:**
```bash
npm run stripe:live              # Full Stripe live/mock test
npm run stripe:live -- --verbose # Verbose output
```

---

## New Files

| File | Purpose |
|------|---------|
| `lib/authService.js` | AuthService: register, login, refresh, logout, JWT verify |
| `scripts/stripe-live-test.js` | 7-step Stripe live/mock test harness |
| `apps/web/src/app/login/page.jsx` | Login + register UI |
| `db/migration_phase26.sql` | ecos_users, auth_refresh_tokens, stripe tables |
| `tests/v143Auth.test.js` | ~40 tests |
| `docs/CHANGELOG_V143.md` | This file |
| `MIGRATION_NOTES_V143.md` | Upgrade guide |

## Modified Files

| File | Change |
|------|--------|
| `ecos-api-server.js` | 5 new auth endpoints + DB wiring for authService |
| `apps/web/src/app/layout.jsx` | Added `🔑 Login` nav link |
| `package.json` | 142.0.0 → 143.0.0, added stripe:live scripts |

---

## Invariants Preserved

1. ✅ `lib/fiatLedger.js` — NOT modified (sacred, MD5 unchanged)
2. ✅ `lib/auditLog.js`  — NOT modified (sacred, MD5 unchanged)
3. ✅ BigInt-only accounting — no floats in ledger operations
4. ✅ No new npm dependencies (`crypto.scrypt` is Node built-in)
5. ✅ All V142 endpoints preserved
6. ✅ Existing validator login (`/api/v1/validator/login`) still works

---

## Test Count

| File | Tests |
|------|-------|
| `tests/v143Auth.test.js` | ~40 |

**Expected total: ≥1133** (V142: ≥1093 + V143: ~40)
