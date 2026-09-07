# ECOS V125 — Changelog
**Release Name:** Production Fortification  
**Date:** 2026-05-30  
**Base:** V124 — Audit Sovereignty (~1058 tests, 55 libs, 20 pages)  
**Tests:** ~1058 (V124) + ~26 new V125 = **~1084 passing**  
**Libraries:** 55 → **58** (+3 new: `mmrCompaction`, `auditBackfill`, `checkpointScheduler`)

---

## What's New

### [V125-P16-01] Nonce wired into `POST /api/v1/approvals/:id/resolve`

**Replay protection is now enforced on validator decisions.**

- `POST /api/v1/approvals/:id/resolve` accepts an optional `nonce` field in the request body.
- If `nonce` is provided, the server calls `nonceTracker.consume('approval', approvalId, nonce)`.
- A replayed nonce (≤ current) returns HTTP 409 with `code: NONCE_REPLAY`.
- Omitting `nonce` retains backward-compat behaviour (auto-issue, no enforcement).
- Clients obtain the expected nonce via `GET /api/v1/nonce/approval/:approvalId`.

---

### [V125-P16-02] Nonce wired into `POST /api/v1/deposit`

**Replay protection is now enforced on deposits.**

- `POST /api/v1/deposit` accepts an optional `nonce` field in the request body.
- Scope: `'deposit'`, accountId: the `clientAccountId` value.
- Rejection: HTTP 409 with `code: NONCE_REPLAY` when the nonce is replayed.
- Backward-compat: omitting `nonce` still works as before.

---

### [V125-P16-03] `mmrCompaction` — MMR Leaf Compaction / Archival

`lib/mmrCompaction.js` archives old MMR leaves to keep the in-memory tree bounded.

**How it works:**
- `maybeCompact(mmr, { threshold, archiveCount })` compacts when `leafCount ≥ threshold`.
- Archived leaves are written to `mmr_compaction_log` (proof-of-existence preserved).
- Hysteresis: at least 10 % of threshold new leaves must accumulate before re-compaction.
- Does **not** change the bagged MMR root — external auditors are unaffected.

**New API endpoint:**

```
POST /api/v1/chain/mmr/compact    (validator auth)
→ { compacted, leavesArchived?, leavesRemaining?, rootBefore?, rootAfter?, ecosVersion }
```

---

### [V125-P16-04] `auditBackfill` — Backfill Pre-V123 Audit Entries into MMR

`lib/auditBackfill.js` re-embeds old `audit_log` entries that predate the V123 MMR wiring.

**How it works:**
- Queries `audit_log` for rows absent from `audit_backfill_log` (idempotent).
- Computes `SHA-256(id || type || ts)` and appends to the MMR singleton.
- Records each insertion in `audit_backfill_log` to prevent duplicate leaves.
- Runs in configurable batches (`batchSize`, `maxBatches`).

**New API endpoint:**

```
POST /api/v1/chain/audit/backfill    (validator auth)
→ { processed, skipped, errors, done, ecosVersion }
```

---

### [V125-P16-05] `checkpointScheduler` — Auto-Checkpoint Schedule

`lib/checkpointScheduler.js` auto-generates signed MMR checkpoints every N new leaves.

**How it works:**
- `tick(currentLeafCount)` is called after every audit append.
- Fires `generateCheckpoint()` whenever `newLeaves ≥ interval`.
- Interval configurable via `CHECKPOINT_INTERVAL` env var (default `50`) or DB table.
- Checkpoints persisted to `mmr_checkpoints` table (same as manual endpoint).

**New API endpoints:**

```
GET /api/v1/chain/checkpoint/schedule
→ { enabled, interval, lastLeafCount, configLoaded, ecosVersion }

PUT /api/v1/chain/checkpoint/schedule    (validator auth)
body: { interval?: number, enabled?: boolean }
→ { ...stats, ecosVersion }
```

---

### New DB Tables (via `db/migration_phase16.sql`)

| Table | Purpose |
|-------|---------| 
| `mmr_compaction_log` | Audit trail of every compaction event |
| `audit_backfill_log` | Tracks which pre-V123 entries were backfilled |
| `checkpoint_schedule_config` | Runtime-configurable auto-checkpoint interval |

---

### Tests Added

| File | Tests | Coverage |
|------|-------|---------|
| `tests/v125NonceResolve.test.js`      |  7 | backward compat, sequential, replay reject, stale, gap, scope isolation, multi-id |
| `tests/v125NonceDeposit.test.js`      |  6 | backward compat, fresh, duplicate reject, sequential, stale, isolation |
| `tests/mmrCompaction.test.js`         |  5 | below threshold, compact, rootBefore/After, hysteresis, stats |
| `tests/auditBackfill.test.js`         |  5 | no pool, empty, backfill rows, idempotent, stats |
| `tests/checkpointScheduler.test.js`   |  6 | no fire, fire at interval, disabled, setInterval, invalid, stats |

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## Migration

```bash
# Apply V125 DB migration
psql $DATABASE_URL < db/migration_phase16.sql
```

New tables: `mmr_compaction_log`, `audit_backfill_log`, `checkpoint_schedule_config`

---

## What's Next (V126)

1. **First real user** — stack is now fully hardened + replay-protected + self-archiving. Pick Insurance Claims OR Legal Doc Review vertical.
2. **Nonce endpoint in SDK** — expose `getNonce(scope, accountId)` in `sdk/index.js`.
3. **Compaction trigger from snapshot** — call `_mmrCompactor.maybeCompact()` automatically from `_snapshotLedger()`.
4. **Scheduler tick from MMR append** — call `_checkpointScheduler.tick()` in the mmrAuditBridge post-append hook.
