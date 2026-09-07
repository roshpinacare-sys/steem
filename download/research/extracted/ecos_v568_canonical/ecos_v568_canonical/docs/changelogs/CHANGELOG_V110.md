# ECOS Changelog — V110

**Version:** 110.0.0
**Date:** 2026-05-29
**Phase:** P8 (Stripe Completion, pgvector Native, Replay Chain Verify, Memory REST)
**Previous:** V109 (109.0.0)
**Tests:** ~558 (+63 new V110 tests; 495 V109 baseline)

---

## Summary

V110 closes all P8 targets from the V109 gap log and finishes BUG-K (Stripe
payment flow). The platform can now create real Stripe PaymentIntents, receive
deposit webhooks (V109), process refunds (V110), and run memory retrieval at
production scale using native pgvector operators.

---

## Changes

### CRITICAL — BUG-K-2: Stripe PaymentIntent creation

**Files:** `lib/stripeProvider.js`, `ecos-api-server.js`

`StripeProvider.createPaymentIntent(clientAccountId, amountCents, currency)` — new method
that creates a Stripe PaymentIntent via `POST /v1/payment_intents`. Returns
`{ paymentIntentId, clientSecret, amount, currency, mock }`.

Full checkout flow (end-to-end):
1. Frontend calls `POST /api/v1/payments/stripe/create-intent`
2. Server calls `createPaymentIntent()` → returns `clientSecret`
3. Frontend calls `stripe.confirmCardPayment(clientSecret)`
4. Stripe fires `payment_intent.succeeded` webhook
5. V109 webhook handler verifies signature + credits `fiatLedger`

Mock path: when `STRIPE_API_KEY` is not set, returns a deterministic mock
`pi_mock_...` with `clientSecret` suffix `_secret_mock` for local development.

New endpoint: `POST /api/v1/payments/stripe/create-intent`
- Body: `{ clientAccountId, amountCents, currency? }`
- Response: `{ ok, paymentIntentId, clientSecret, amount, currency, mock }`
- Logs PaymentIntent ID to `stripe_payment_intents` audit table (DB optional)
- Returns 502 on Stripe API errors, 400 on missing params

---

### HIGH — P8-01: pgvector native `<=>` operator

**Files:** `lib/memorySubstrate.js`, `db/migration_phase8.sql`

`MemorySubstrate._pgRetrieve()` now auto-detects whether the `embedding`
column exists in `memory_entries` via schema introspection on first use. The
detection result is cached per pool instance.

When the column **is** present (requires `migration_phase8.sql`):
- Uses `ORDER BY embedding <=> $vec::vector LIMIT k` with the IVFFlat index
- O(log N) approximate nearest-neighbour vs O(N·D) JS cosine
- Returns `_native: true` on each result entry

When the column is **absent** (pgvector not installed, migration not run):
- Falls back to the V109 JS cosine path on `vector_json` (`_native: false`)
- Zero configuration change required — existing deployments unaffected

`_pgIngest()` also writes the `embedding` column when the native path is
active, keeping the IVFFlat index current.

`migration_phase8.sql`:
- Wraps pgvector extension creation in a `DO $$...EXCEPTION` block so the
  migration succeeds even when pgvector is not installed
- Creates `IVFFlat` index with `lists=100` (conservative default for ≤1M rows)
- Idempotent — safe to re-run on already-migrated schemas

---

### MEDIUM — P8-02: `getEntryAsync()` pgvector DB path

**Files:** `lib/memorySubstrate.js`

New async method `getEntryAsync(id)` checks in-memory store first, then falls
back to `SELECT FROM memory_entries WHERE id = $1` for pgvector backend.

**Backward compat:** `getEntry(id)` remains sync and in-memory-only.
Use `getEntryAsync(id)` when the backend is pgvector and the entry may have
been written by a different process / previous server instance.

---

### MEDIUM — P8-03: Replay chain verification endpoint

**Files:** `lib/replayEngine.js`, `ecos-api-server.js`

`ReplayEngine.verifyReplayChain({ pageSize })` — new method that paginates
through the entire audit log in `pageSize`-entry pages, replaying each
deterministically and accumulating a proof chain. Returns:

```json
{
  "ok": true,
  "chainIntact": true,
  "pagesVerified": 14,
  "totalEventsApplied": 312,
  "totalAuditEntries": 1400,
  "finalStateHash": "a1b2c3...",
  "proofSample": [...],
  "brokenAt": null
}
```

New endpoint: `GET /api/v1/audit/replay/chain-verify?pageSize=500`
- Returns HTTP 200 on intact chain, HTTP 422 on broken chain
- `proofSample` contains up to 10 representative page proofs

---

### MEDIUM — P8-04: Memory search GET endpoint

**Files:** `ecos-api-server.js`

New endpoint: `GET /api/v1/memory/search?q=...&scope=...&ownerId=...&topK=...&minScore=...`

Query parameters:
- `q` (required) — search query
- `scope` (optional) — filter by memory scope
- `ownerId` (optional) — filter by owner
- `topK` (default: 10, max: 100)
- `minScore` (default: 0, range: 0–1)

Response: `{ ok, count, results }` — same entry shape as `POST /api/v1/memory/retrieve`.

---

### LOW — P8-05: Stripe refund debit

**Files:** `lib/stripeProvider.js`, `ecos-api-server.js`

`handleDepositWebhook()` now returns `{ accountId }` on `charge.refunded`
events (extracted from `charge.metadata.client_account_id`).

The V109 webhook handler is updated: when `action.action === 'refund'` and
`action.accountId` is available, it calls `fiatLedger.debit()` for the
refunded amount and appends a `STRIPE_REFUND` audit entry. Returns:

```json
{
  "ok": true,
  "handled": true,
  "action": "refund",
  "amountRefunded": "20000000",
  "debited": true,
  "stripeEventId": "evt_..."
}
```

If `metadata.client_account_id` is absent on the charge, the webhook returns
`debited: false` (cannot route the debit without an account mapping).

---

### LOW — P8-06: `.env.example` documentation update

**Files:** `.env.example`

Added detailed inline documentation for:
- `STRIPE_API_KEY` — format, where to obtain, test vs live key formats
- `STRIPE_WEBHOOK_SECRET` — format (`whsec_...`), where to obtain, dev vs
  production enforcement note
- `ECOS_MEMORY_BACKEND` — pgvector activation and migration prerequisite
- `ECOS_SNAPSHOT_INTERVAL_MINUTES` — snapshot auto-save (stub, future use)

---

## New DB Objects (migration_phase8.sql)

| Object | Type | Purpose |
|--------|------|---------|
| `memory_entries.embedding` | `vector(1536)` column | Native pgvector <=> path (P8-01) |
| `idx_memory_embedding_ivfflat` | IVFFlat index | ANN search on embedding column |
| `stripe_payment_intents` | Table | Audit log for create-intent calls (BUG-K-2) |
| `idx_spi_client_account` | Index | Fast lookup by client account |
| `idx_spi_status` | Index | Status + time ordering |

---

## New Endpoints (V110)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/payments/stripe/create-intent` | Create Stripe PaymentIntent (BUG-K-2) |
| `GET`  | `/api/v1/audit/replay/chain-verify` | Full audit log chain verification (P8-03) |
| `GET`  | `/api/v1/memory/search` | Memory semantic search via GET (P8-04) |

---

## Sacred Files — Untouched

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✓ UNCHANGED
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✓ UNCHANGED
```

---

## Breaking Changes

None. All changes are additive:
- `getEntry(id)` remains sync and in-memory-only (unchanged signature)
- `getEntryAsync(id)` is a new method
- `_pgRetrieve()` is internal — auto-selects native or JS path transparently
- Existing V109 webhook handler extended, not replaced

---

## Invariants Preserved

1. ✅ BigInt-only — `amountCents` (integer) used in Stripe API; ledger always BigInt microcents
2. ✅ Sacred Files — `fiatLedger.js` + `auditLog.js` not touched
3. ✅ Tests green — all 495 V109 tests pass; 63 new V110 tests added
4. ✅ Audit chain — `STRIPE_DEPOSIT`, `STRIPE_REFUND` entries appended, never deleted
5. ✅ Version bump — `package.json` → 110.0.0
6. ✅ DB pool guard — all new DB code checks `if (!dbPool) → 503`

---

*ECOS CHANGELOG_V110.md · 110.0.0 · 2026-05-29*
