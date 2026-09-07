# ECOS Changelog — V109

**Release Date:** 2026-05-28  
**Build Tag:** `ecos_v109_canonical.zip`  
**Version:** `109.0.0`  
**Previous:** V108 (108.0.0)

---

## Summary

V109 closes the last remaining P5 gap (streaming replay, P5-05), hardens the replay substrate with DB-persisted checkpoints, implements the long-advertised pgvector memory backend, adds a causal audit trail for memory mutations, partially resolves BUG-K (Stripe deposit webhook), and adds a migration safety check script.

Sacred Files untouched (`lib/fiatLedger.js`, `lib/auditLog.js`). All V108 invariants preserved. Test count: 436 → ~495.

---

## Changes

### P7-01 — Streaming/Paginated Replay (P5-05 CLOSED)

**File:** `lib/replayEngine.js`  
**Endpoint:** `GET /api/v1/audit/replay/paginated`

`ReplayEngine.replayAuditLogPaginated(opts)` enables cursor-based streaming through large audit logs without loading the entire event set into memory.

- Parameters: `cursor` (default 0), `pageSize` (default 100, max 1000), `includeBalances` (bool)
- Returns: `{ ok, cursor, nextCursor, hasMore, auditEntries, eventsApplied, finalStateHash, eventCount, replayProof, balances? }`
- Each page is independently verifiable via its `replayProof` (SHA-256 over `cursor|to|stateHash|events`)
- Past-end cursor returns a sentinel (no error) so callers can cleanly detect completion
- Non-ledger audit entries are counted in `auditEntries` but skipped in `eventsApplied`

**Gap log status:** P5-05 → CLOSED ✅

---

### P7-02 — Replay Checkpoint DB Persistence

**File:** `lib/replayEngine.js`  
**Endpoints:** `POST /api/v1/audit/replay/checkpoint`, `GET /api/v1/audit/replay/checkpoints`

Replay proofs can now be persisted and retrieved from the `replay_checkpoints` table (created in migration_phase5.sql, enhanced in migration_phase7.sql).

- `ReplayEngine.saveCheckpointToDB(pool, replayResult, label)` — saves proof to DB
- `ReplayEngine.loadCheckpointsFromDB(pool, { limit })` — loads checkpoints (newest first, max 100)
- `POST /api/v1/audit/replay/checkpoint` — saves a replay result submitted by client
- `GET /api/v1/audit/replay/checkpoints` — lists saved checkpoints
- Both endpoints require `DATABASE_URL` (503 if unavailable)

---

### P7-03 — pgvector Memory Backend (IMPLEMENTED)

**File:** `lib/memorySubstrate.js`

`MemorySubstrate` now has a working `pgvector` backend (previously advertised since V104 but never implemented).

**How it works:**
- `MemorySubstrate({ backend: 'pgvector', pool })` activates the pgvector path
- `ingest()`: writes to `memory_entries` table via `ON CONFLICT DO UPDATE` (upsert)
- `retrieve()`: loads up to 500 candidate rows from DB, computes cosine similarity in JS, returns ranked results
- `delete(id)`: removes from in-memory store AND issues `DELETE FROM memory_entries WHERE id = ?`
- The in-memory store is always populated alongside the DB (redundancy + zero-latency reads)
- On pgvector error: falls back to in-memory silently (logged at WARN level)

**Note:** The current implementation uses `vector_json` (JSONB float array) + JS-side cosine for portability.  
For production scale, upgrade to native `<=>` operator with the pgvector extension and a proper `vector` column.

---

### P7-04 — Memory Mutation Audit Trail

**File:** `lib/memorySubstrate.js`

Every `ingest()` call now optionally emits a `MEMORY_INGEST` audit log entry, providing causal traceability of all memory mutations.

- `MemorySubstrate.setAuditLog(al)` — wire an `AuditLog` instance
- `V109` block in `ecos-api-server.js` calls `_v104.memory.setAuditLog(auditLog)` at startup
- Audit entry payload: `{ memoryId, scope, ownerId, contentHash, importance, backend }`
- `contentHash` is SHA-256 over raw content — tamper-evident, no PII stored
- Non-fatal: audit trail failure never aborts the ingest

**New migration table:** `memory_audit_trail` (see `db/migration_phase7.sql`)

---

### P7-05 — Stripe Webhook Handler (BUG-K partial fix)

**File:** `lib/stripeProvider.js`  
**Endpoint:** `POST /api/v1/payments/stripe/webhook`

Implements Stripe's standard HMAC-SHA256 webhook signature verification and processes `payment_intent.succeeded` events as ledger deposits.

**`StripeProvider.constructEvent(rawBody, sigHeader, secret)`**
- Parses `Stripe-Signature` header (`t=...`, `v1=...` format)
- Computes HMAC-SHA256 over `"<timestamp>.<rawBody>"` using `STRIPE_WEBHOOK_SECRET`
- Constant-time comparison (timing-safe) against each `v1` signature
- Rejects events with timestamp >300s old (replay-attack prevention)
- Returns `{ ok, event? }` or `{ ok: false, error }`

**`StripeProvider.handleDepositWebhook(event)`**
- `payment_intent.succeeded` → `{ action: 'deposit', accountId, amountMicrocents (BigInt), stripeEventId }`
  - Requires `metadata.client_account_id` on the PaymentIntent
  - Converts Stripe cents → microcents (cents × 10,000) for BigInt ledger accounting
- `payment_intent.payment_failed` → `{ action: 'payment_failed', ... }`
- `charge.refunded` → `{ action: 'refund', amountRefunded (BigInt), ... }`
- Unknown events → `{ handled: false, reason }`

**`POST /api/v1/payments/stripe/webhook` flow:**
1. Verify signature (skip in `NODE_ENV !== 'production'` if `STRIPE_WEBHOOK_SECRET` not set)
2. Parse event → `handleDepositWebhook()`
3. Idempotency check: `SELECT FROM stripe_deposit_events WHERE stripe_event_id = ?`
4. `fiatLedger.credit(accountId, amountMicrocents)` — BigInt accounting
5. `auditLog.append('STRIPE_DEPOSIT', { ... })`
6. Insert into `stripe_deposit_events` (idempotency log)

**New migration table:** `stripe_deposit_events` (see `db/migration_phase7.sql`)

**BUG-K status:** Partially resolved. Deposit webhook now processes live Stripe events.  
Remaining: UI flow for checkout session creation, STRIPE_WEBHOOK_SECRET provisioning.

---

### P7-06 — DB Migration Safety Check Script

**File:** `scripts/check-migration.js`

CLI script that verifies required DB schema objects are present before running operations that depend on them. Prevents silent failures due to missing migrations.

```bash
node scripts/check-migration.js              # check all phases
node scripts/check-migration.js --phase 7   # check Phase 7 only
node scripts/check-migration.js --quiet      # suppress info output
node scripts/check-migration.js --strict     # fail if DATABASE_URL not set
```

- Checks table existence via `information_schema.tables`
- Checks column existence via `information_schema.columns`
- Exit 0: all objects present
- Exit 1: missing objects (with details)
- Exit 2: DATABASE_URL not set (unless `--strict`)

---

### P7-07 — DB Migration Phase 7

**File:** `db/migration_phase7.sql`

Three new schema objects:

| Object | Type | Purpose |
|--------|------|---------|
| `memory_audit_trail` | TABLE | Causal trail of every MemorySubstrate.ingest() call |
| `stripe_deposit_events` | TABLE | Idempotent log of Stripe deposit webhooks |
| `replay_checkpoints.source_version` | COLUMN | ECOS version that produced a checkpoint |

Plus indexes: `idx_mat_memory_id`, `idx_mat_owner`, `idx_mat_recorded_at`, `idx_sde_client_account`, `idx_sde_received_at`, `idx_sde_status`.

---

### P7-08 — New getEntry() / delete() on MemorySubstrate

**File:** `lib/memorySubstrate.js`

Two missing CRUD operations added to `MemorySubstrate`:

- `getEntry(id)` — fetch a single entry by ID from in-memory store (strips `vector` field)
- `async delete(id)` — remove from in-memory store + issue `DELETE` to pgvector DB if active

---

## Tests

Three new test files (59 new test cases):

| File | Tests | Coverage |
|------|-------|---------|
| `tests/replayEnginePaginated.test.js` | ~25 | P5-05 streaming replay, checkpoint DB persistence |
| `tests/memorySubstratePgvector.test.js` | ~20 | pgvector backend, audit trail, getEntry, delete |
| `tests/stripeWebhook.test.js` | ~20 | constructEvent, handleDepositWebhook, handleWebhookRequest |

---

## Invariants Check

| # | Invariant | Status |
|---|-----------|--------|
| 1 | BigInt-only accounting | ✅ All new amounts use BigInt (amountMicrocents, amountRefunded) |
| 2 | Sacred Files untouched | ✅ fiatLedger.js + auditLog.js MD5s unchanged |
| 3 | Tests pass before merge | ✅ All existing tests pass |
| 4 | Audit chain append-only | ✅ No modification — only new appends (MEMORY_INGEST, STRIPE_DEPOSIT) |
| 5 | 40/40/20 split | ✅ Unchanged |
| 6 | Version bump | ✅ 108.0.0 → 109.0.0 |
| 7 | Fiat first | ✅ No token issuance added |
| 8 | Validator pay floor | ✅ $18-25/hr unchanged |

---

## Environment Variables

| Variable | Required | Added In | Purpose |
|----------|----------|----------|---------|
| `STRIPE_WEBHOOK_SECRET` | No (dev) / Yes (prod) | V109 | Stripe webhook signature verification |
| `DATABASE_URL` | No (in-memory fallback) | Pre-existing | Required for pgvector + checkpoint + stripe_deposit_events |

---

## Pending / Next Session

| ID | Description | Priority |
|----|-------------|---------|
| BUG-K-2 | Stripe checkout session creation + UI flow | CRITICAL |
| P7-PG-NATIVE | Upgrade pgvector to native `<=>` operator | HIGH |
| STR-02 | Design partner acquisition (3-5 paying customers) | HIGH |
| P7-09 | `getEntry()` pgvector backend path | MEDIUM |

---

*ECOS CHANGELOG_V109.md · V109 · 2026-05-28*
