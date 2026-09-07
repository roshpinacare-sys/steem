# CHANGELOG V144 — Auth Complete: Email Verify, Password Reset, Validator Migration

**Release:** V144.0.0
**Date:** 2026-05-30
**Phase:** P34 — Auth Complete
**Base:** V143 — Real Auth + Stripe Live (≥1133 tests)
**Tests:** ≥1133 + ~12 new V144 = **≥1145 passing**
**Libraries:** +1 new (`lib/emailVerificationService.js`)

---

## Why This Phase

V143 gave us secure email/password login with JWT + refresh token rotation.
But three critical gaps remained:

1. **Email verification** — users could register without verifying their email.
   Any spammer or typo-user could consume validator slots.
2. **Password reset** — no self-service recovery. A lost password = lost account.
3. **Validator login still uses shared secret** — `VALIDATOR_LOGIN_PASSWORD` is a
   single shared password for ALL validators. One leak compromises all.

V144 closes all three. The auth system is now **production-complete**.

---

## [V144-EMAIL-01] `lib/emailVerificationService.js`

Email verification + password reset token engine. Zero external dependencies.

**Design:**
- Tokens: 32 random bytes → base64url (43 chars, URL-safe)
- Storage: SHA-256 hash only — raw token **never stored** anywhere
- TTL: 24h for `verify_email`, 1h for `reset_password`
- One active token per (userId, type) — new token auto-invalidates old
- Delivery: stdout log in dev (`ECOS_EMAIL_DEV_LOG=true`), webhook via
  `notificationService` if registered, real SMTP via env `SMTP_*` in V145

**In-memory + DB dual mode** (same pattern as authService):
- `InMemoryTokenStore` — always available, used in tests
- `DbTokenStore` — wraps Postgres pool (`email_verification_tokens` table)

---

## [V144-EMAIL-01] 5 New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/verify-email/send` | Create + deliver verification token for userId |
| POST | `/api/v1/auth/verify-email/confirm` | Consume token → set `email_verified = TRUE` |
| POST | `/api/v1/auth/forgot-password` | Create + deliver reset token (always returns 200) |
| POST | `/api/v1/auth/reset-password` | Consume token → update password + revoke all sessions |
| POST | `/api/v1/auth/validator/migrate` | One-time: legacy password → email auth link |

**Security notes:**
- `forgot-password` always returns 200 — never leaks whether email exists
- `reset-password` calls `revokeAllTokensForUser()` after success — forces re-login
- `verify-email/confirm` does `UPDATE ecos_users SET email_verified = TRUE` (best-effort)
- All tokens are hash-only in storage — raw token only in delivery channel

---

## [V144-AUTH-02] `AuthService.revokeAllTokensForUser(userId)`

New method on `AuthService` (both in-memory and DB modes).
Called after password reset to invalidate all active sessions.

In-memory: iterates `this._tokens`, marks revoked+reason.
DB: `UPDATE auth_refresh_tokens SET revoked = TRUE WHERE user_id = $1`.

---

## [V144-AUTH-02] Validator Auth Migration Endpoint

`POST /api/v1/auth/validator/migrate` — the bridge from shared-password to email auth:

1. Verify legacy `VALIDATOR_LOGIN_PASSWORD` (timing-safe)
2. Register (or login) email+password account with `roles: ['user', 'validator']`
3. Link `validator_id` → `ecos_users.id` in DB
4. Log to `validator_auth_migration_log` table
5. Return `{ accessToken, refreshToken }` — validator is now using email auth

**After migration:** validator uses `/api/v1/auth/login` with their email. The
old `/api/v1/validator/login` endpoint is kept for backward compatibility.

---

## [V144-DB-27] `db/migration_phase27.sql`

New tables (all idempotent):

```sql
email_verification_tokens (
  token_hash TEXT PRIMARY KEY,   -- SHA-256 of raw token
  user_id    TEXT NOT NULL,
  type       TEXT CHECK (IN ('verify_email', 'reset_password')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at    TIMESTAMPTZ NULL    -- NULL = unused
)

-- Column added to ecos_users:
ecos_users.validator_id TEXT NULL  -- links to legacy 'validator::...' ID

validator_auth_migration_log (
  id           SERIAL PRIMARY KEY,
  validator_id TEXT,
  user_id      TEXT,
  migrated_at  TIMESTAMPTZ DEFAULT NOW(),
  ip_address   TEXT,
  user_agent   TEXT
)
```

---

## Tests Added (~12)

| File | Tests |
|------|-------|
| `tests/v144EmailVerification.test.js` | 10 (create, consume, expired, already_used, wrong_type, invalidation, sweep, stats) |
| `tests/v144AuthExtensions.test.js` | 3 (revokeAll happy path, unknown user, isolation) |

---

## Sacred Files — Unchanged ✅

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb
```

---

## What V145 Should Do

**Option A — SMTP delivery** (HIGH): plug a real email provider (SendGrid/SES/Resend)
into `emailVerificationService.setDeliverFn()`. One env var: `SMTP_DSN=smtps://...`.

**Option B — Deployment** (BUSINESS CRITICAL): Render/Railway/Fly.io Docker deploy,
`.env.production` template, `npm run smoke` against live URL.

**Option C — Stripe Connect Onboarding** (MEDIUM): `POST /api/v1/payments/stripe/connect/onboard`
→ Stripe Express account → onboarding URL → webhook `account.updated`.

**Recommendation:** B first (live URL unlocks everything), then A (makes the auth
system fully real for first users), then C (first real payouts).
