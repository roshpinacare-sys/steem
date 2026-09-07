# ECOS Changelog — V113

**Version:** 113.0.0  
**Date:** 2026-05-29  
**Phase:** P9 (Production Hardening)  
**Previous:** V112 (112.0.0)  
**Tests:** ~690+ (all V112 tests + 30+ new V113 tests)

---

## Summary

V113 closes all P9 production-hardening targets from the V110 gap log.
The platform now has automatic state persistence (snapshot cron), 
in-memory memory management (compaction API), pgvector visibility 
in the health endpoint, correct Stripe payment lifecycle tracking,
paginated memory search, updated re-embed script, and a machine-readable
EU AI Act compliance report — ready for the August 2, 2026 enforcement deadline.

Sacred Files untouched (`lib/fiatLedger.js`, `lib/auditLog.js`). 
All V112 invariants preserved.

---

## Changes

### P9-01 — Snapshot Auto-Save Cron

**File:** `ecos-api-server.js` (V113 `_v113` init block)

New `ECOS_SNAPSHOT_INTERVAL_MINUTES` environment variable. When set to a
positive integer, a `setInterval` fires every N minutes and calls:

1. `_v106.snapshotEngine.export()` — captures current state (ledger + auditLog + hitlGate)
2. If `DATABASE_URL` is set: `exportToDB(dbPool, snap)` → persists to `snapshots` table
3. Otherwise: file-backed snapshot (existing behavior)

The interval handle is `.unref()`'d so it never prevents clean process exit.
Non-fatal: snapshot failures are logged at WARN and never abort the server.

**New env var:** `ECOS_SNAPSHOT_INTERVAL_MINUTES` (default: 0 = disabled)

---

### P9-02 — Memory Compaction API

**Files:** `lib/memorySubstrate.js`, `ecos-api-server.js`

`MemorySubstrate.compact({ scope, threshold })` — new method that evicts
low-importance, never-accessed entries from the in-memory cache.

Eviction criteria: `entry.importance < threshold AND entry.accessCount === 0`
- Default threshold: `0.3`
- Returns: `{ evictedCount, totalBefore, totalAfter }`
- When pgvector backend is active: only in-memory cache is evicted, DB rows are preserved

New endpoint: `POST /api/v1/memory/compact`
- Query/Body: `scope` (optional, defaults to all scopes), `threshold` (optional, 0–1, default 0.3)
- Response: `{ ok, evictedCount, totalBefore, totalAfter, scope }`
- Returns 400 for out-of-range threshold values
- Returns 503 if MemorySubstrate is not initialised

---

### P9-03 — Health Endpoint pgvector Status

**File:** `ecos-api-server.js`

`GET /api/v1/health` now includes a `pgvector` field:

```json
{
  "pgvector": {
    "native": false,
    "embeddingColumnExists": false
  }
}
```

- `native: true` when the `embedding` column (native pgvector `<=>` path) is active
- `embeddingColumnExists: true` when native path is active (implies `migration_phase8.sql` was run)
- Both fields are `false` when the JS cosine fallback is in use or MemorySubstrate is not wired

---

### P9-04 — Stripe PaymentIntent Status Sync

**File:** `ecos-api-server.js`

When the `payment_intent.succeeded` webhook fires and the ledger credit succeeds,
the server now issues an additional SQL update:

```sql
UPDATE stripe_payment_intents
SET status = 'succeeded', updated_at = NOW()
WHERE payment_intent_id = $1 AND status != 'succeeded'
```

This fixes the lifecycle gap where `stripe_payment_intents.status` remained
`'created'` indefinitely after a successful payment. The update is non-fatal:
if the table doesn't exist or the row isn't present, the error is logged at WARN
and the webhook response is unaffected.

**New column used:** `stripe_payment_intents.updated_at` (add via migration if missing — see `db/migration_phase10.sql`)

---

### P9-05 — Memory Search Pagination

**File:** `ecos-api-server.js`

`GET /api/v1/memory/search` now supports cursor-based pagination:

```
GET /api/v1/memory/search?q=contract&cursor=10&limit=5
```

New query params:
- `cursor` (default: 0) — offset into results
- `limit` (default: topK) — page size (max 100)

Extended response:
```json
{
  "ok": true,
  "count": 5,
  "total": 23,
  "results": [...],
  "cursor": 10,
  "nextCursor": 15,
  "hasMore": true
}
```

Backward-compatible: existing callers that don't use `cursor`/`limit` continue
to work unchanged (cursor=0 returns the first page, `hasMore` is false when
all results fit in one page).

---

### P9-06 — Re-embed Script pgvector Column Sync

**File:** `scripts/reembed-patches.js`

New `syncMemoryEntryEmbedding(db, patchId, vector)` function that runs alongside
`updatePatch()` for each re-embedded patch. When the `memory_entries.embedding`
column exists (phase8 migration applied), the function issues:

```sql
UPDATE memory_entries
SET embedding = $1::vector, vector_json = $2, updated_at = NOW()
WHERE id = $3 AND embedding IS DISTINCT FROM $1::vector
```

Non-fatal: silently skips if the pgvector `embedding` column doesn't exist yet.
This ensures the IVFFlat index stays current after a re-embed run.

---

### P9-07 — EU AI Act Compliance Report Endpoint

**File:** `ecos-api-server.js`

New endpoint: `GET /api/v1/audit/eu-ai-act-report`

Returns structured compliance evidence for Art.12 (audit logging) and Art.14
(human oversight). Machine-readable JSON suitable for compliance auditors.

Response structure:
```json
{
  "ok": true,
  "generatedAt": "2026-05-29T...",
  "version": "V113",
  "deadline": "2026-08-02T00:00:00Z",
  "daysRemaining": 64,
  "regulation": { "name": "EU AI Act", "articles": [...] },
  "overallCompliant": true,
  "coverage": {
    "art12_auditLogging":    { "compliant": true, "article": "Art.12", "detail": "..." },
    "art12_cryptoIntegrity": { "compliant": true, "article": "Art.12", "detail": "..." },
    "art12_logRetention":    { "compliant": true, "article": "Art.12", "detail": "..." },
    "art14_humanOversight":  { "compliant": true, "article": "Art.14", "detail": "..." },
    "art14_confidenceGate":  { "compliant": true, "article": "Art.14", "detail": "..." },
    "art14_overrideCapability": { ... },
    "art14_auditBindingToDecisions": { ... }
  },
  "auditChain":       { "length": 142, "intact": true, "headHash": "a1b2c3...", "dbBacked": false },
  "humanOversight":   { "hitlQueued": 3, "hitlResolved": 2, "autoFlow": 18, "blocked": 0 },
  "confidenceGating": { "autoThreshold": 0.70, "hitlLow": 0.50, "hitlHigh": 0.70, "blockThreshold": 0.30 },
  "recommendations":  [{ "severity": "OK", "msg": "System is compliant..." }]
}
```

HTTP 200 always (even when not compliant — the `overallCompliant` field carries the verdict).
HTTP 500 only on internal error.

---

## New Tests (30 tests across 5 new files)

| File | Tests | Coverage |
|------|-------|---------|
| `tests/snapshotCron.test.js` | 3 | P9-01 cron + P9-03 health pgvector |
| `tests/memoryCompact.test.js` | 5 | P9-02 compact API |
| `tests/memorySearchPagination.test.js` | 6 | P9-05 pagination |
| `tests/stripeStatusSync.test.js` | 3 | P9-04 Stripe webhook + status sync |
| `tests/euAiActReport.test.js` | 11 | P9-07 compliance report |

---

## New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ECOS_SNAPSHOT_INTERVAL_MINUTES` | `0` (disabled) | Auto-save snapshot interval in minutes |

---

## DB Migration

`db/migration_phase10.sql` — adds `updated_at` column to `stripe_payment_intents`
if not already present. Run once: `psql $DATABASE_URL -f db/migration_phase10.sql`

---

## Gap Log Status After V113

| ID | Status | Notes |
|----|--------|-------|
| P9-01 | ✅ CLOSED | Snapshot auto-save cron |
| P9-02 | ✅ CLOSED | Memory compaction API |
| P9-03 | ✅ CLOSED | Health endpoint pgvector status |
| P9-04 | ✅ CLOSED | Stripe payment_intent status sync |
| P9-05 | ✅ CLOSED | Memory search pagination |
| P9-06 | ✅ CLOSED | Re-embed script pgvector column sync |
| P9-07 | ✅ CLOSED | EU AI Act audit report endpoint |

**All P9 targets closed. V114 focus: STR-02/STR-05 (design partner acquisition, beachhead vertical).**
