# ECOS Migration Notes — V109 → V110

**Version:** 110.0.0  **Date:** 2026-05-29

## Overview
V110 is fully backward compatible. All changes are additive.

## Steps

### 1. Apply DB migration (optional)
```bash
psql $DATABASE_URL < db/migration_phase8.sql
```
Adds: `memory_entries.embedding vector(1536)`, IVFFlat index, `stripe_payment_intents` table.
Wrapped in DO block — succeeds silently if pgvector not installed.

### 2. Re-embed existing rows (optional)
```bash
node scripts/reembed-patches.js
```
Populates the new `embedding` column for existing `memory_entries` rows.

### 3. Configure Stripe (optional)
```
STRIPE_API_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```
Register webhook: `POST /api/v1/payments/stripe/webhook`
Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`

### 4. New endpoints
- `POST /api/v1/payments/stripe/create-intent` — create PaymentIntent (BUG-K-2)
- `GET  /api/v1/audit/replay/chain-verify`     — verify full audit chain (P8-03)
- `GET  /api/v1/memory/search?q=...`            — semantic memory search (P8-04)

### 5. New async API
```js
const entry = await memory.getEntryAsync(id); // in-memory first, then DB fallback
```

## Rollback
Restore lib files from git. DB schema changes are backward-compatible with V109.

## Sacred Files
```
lib/fiatLedger.js  MD5: 563e9b1f9e67091a5b6527c0a92568e5  UNCHANGED
lib/auditLog.js    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  UNCHANGED
```

*ECOS MIGRATION_NOTES_V110.md · 110.0.0 · 2026-05-29*
