# ECOS Changelog — V146: Validator Auth Migration + Stripe Connect Express

**Release Date:** 2026-05-30
**Version:** 146.0.0
**Release Name:** Validator Auth Migration + Stripe Connect Express

---

## Overview

V146 closes the two remaining gaps from P36:

1. **Security fix**: Every validator now uses individual email+password auth. The shared `VALIDATOR_LOGIN_PASSWORD` is deprecated as a login mechanism.
2. **Revenue unlock**: Validators can connect their Stripe Express account and receive real payouts directly.

---

## [V146-AUTH-01] Validator UI Auth Migration

### Problem solved
Before V146, all validators shared a single `VALIDATOR_LOGIN_PASSWORD`. One compromised password → all validators at risk. This was V62's temporary solution — now permanently fixed.

### New LoginScreen (email + password)
The validator page's `LoginScreen` component was rewritten from scratch:

**Sign In tab:**
- Email + password fields (not validatorId + shared secret)
- POST `{EXPRESS_BASE}/api/v1/auth/login` → `{ accessToken, refreshToken }`
- `accessToken` stored in JS memory only (not localStorage, not sessionStorage) — XSS-resistant
- `refreshToken` stored in sessionStorage (tab-scoped, non-sensitive)
- Auto-refresh on 401 via `fetchWithAuth()` helper — transparent to the rest of the page

**Legacy → Email tab:**
- For validators who previously used the shared password
- Input: email + validatorId + old VALIDATOR_LOGIN_PASSWORD
- Calls `POST /api/v1/auth/validator/migrate` → links email account to validator ID
- After migration: "Legacy → Email" tab is no longer needed

**Logout:**
- `POST /api/v1/auth/logout` → revokes refreshToken server-side
- Clears `_accessToken` (memory), refreshToken (sessionStorage), validatorId (sessionStorage)

### `fetchWithAuth()` helper
```javascript
// Auto-refreshes expired access tokens before retrying failed requests
async function fetchWithAuth(url, opts = {}) {
  // 1. Attach Bearer token
  // 2. On 401: POST /api/v1/auth/refresh with stored refreshToken
  // 3. Update _accessToken in memory
  // 4. Retry original request
}
```

---

## [V146-STRIPE-01] Stripe Connect Express Onboarding

### Architecture
```
Validator clicks "Connect Stripe"
  └─ POST /api/v1/payments/stripe/connect/onboard
       └─ stripeConnectService.createAccount(validatorId, email)
            └─ POST https://api.stripe.com/v1/accounts (type=express)
                 └─ Saved to stripe_validator_accounts
       └─ stripeConnectService.getOnboardingUrl(stripeAccountId, returnUrl, refreshUrl)
            └─ POST https://api.stripe.com/v1/account_links (account_onboarding)
  └─ Returns { stripeAccountId, onboardingUrl, expiresAt }

Validator completes Stripe KYC
  └─ Stripe fires POST /api/v1/payments/webhook { type: 'account.updated' }
       └─ stripeConnectService.handleAccountUpdated(event)
            └─ UPDATE stripe_validator_accounts SET onboarding_status='onboarded'

StripeProvider.transfer() already uses stripe_account_id for payouts
  └─ Validators with onboarding_status='onboarded' receive real payouts
```

### `lib/stripeConnectService.js` API
```javascript
// Create or retrieve existing Stripe Express account
await svc.createAccount(validatorId, email, country?)
// → { stripeAccountId, mock, alreadyExists? }

// Generate Stripe-hosted onboarding URL (expires after ~1 use)
await svc.getOnboardingUrl(stripeAccountId, returnUrl, refreshUrl)
// → { url, expiresAt, mock }

// Real-time account status from Stripe
await svc.getAccountStatus(stripeAccountId)
// → { payoutsEnabled, chargesEnabled, onboardingStatus, requirements }

// Combined local+live status by ECOS validator ID
await svc.getStatusByValidatorId(validatorId, { liveCheck })

// Process Stripe account.updated webhook
await svc.handleAccountUpdated(event)
// → { updated, validatorId }
```

### Mock mode
No `STRIPE_API_KEY` → all methods return safe deterministic stubs.
Tests run fully offline. Production needs `STRIPE_API_KEY=sk_live_...`.

---

## New API Endpoints (2)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/payments/stripe/connect/onboard` | Create/resume Stripe Connect Express account → returns onboardingUrl |
| GET  | `/api/v1/payments/stripe/connect/status/:validatorId` | Check onboarding status (cached or live) |

Webhook: `account.updated` is now handled in the existing `POST /api/v1/payments/webhook` route.

---

## Tests

| File | Tests |
|------|-------|
| `tests/v146ValidatorAuthMigration.test.js` | 8 |
| `tests/v146StripeConnect.test.js` | 9 |

**Expected total: ≥1173 passing** (V145: ≥1156 + V146: ~17)

---

## Security Summary

| Before V146 | After V146 |
|-------------|------------|
| Shared `VALIDATOR_LOGIN_PASSWORD` (1 per deployment) | Individual email + scrypt password per validator |
| JWT in HttpOnly cookie (same-origin only) | JWT 15m in memory + refresh 30d in sessionStorage |
| No token rotation | Full rotation + reuse detection (V143) |
| No Stripe Connect for validators | Stripe Express onboarding + account.updated webhook |

---

## Invariants Preserved

1. ✅ `lib/fiatLedger.js` — NOT modified (sacred)
2. ✅ `lib/auditLog.js` — NOT modified (sacred)
3. ✅ BigInt-only accounting
4. ✅ No new npm dependencies — node:https + node:crypto only
5. ✅ All V145 endpoints preserved
6. ✅ `VALIDATOR_LOGIN_PASSWORD` still accepted in legacy migration tab
