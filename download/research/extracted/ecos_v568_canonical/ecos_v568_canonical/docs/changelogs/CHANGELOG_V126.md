# ECOS V126 — Changelog
**Release Name:** Live Integration  
**Date:** 2026-05-30  
**Base:** V125 — Production Fortification (~1084 tests, 58 libs, 20 pages)  
**Tests:** ~1084 (V125) + ~20 new V126 = **~1104 passing**  
**Libraries:** 58 → **58** (no new libs; changes are wiring + SDK expansion)

---

## What's New

### [V126-P17-01] Auto-compact from `_snapshotLedger()`

`_snapshotLedger()` now triggers `_mmrCompactor.maybeCompact(defaultMMR)` after every ledger snapshot.

- Non-blocking (`.catch(() => {})`), non-fatal.
- Compaction only fires when `leafCount ≥ threshold` (default 500) with hysteresis.
- A log line at `INFO` level records every compaction: `leavesArchived`, `leavesRemaining`.

---

### [V126-P17-02] Auto-tick checkpoint scheduler from MMR append

Every `auditLog.append()` call now propagates through a new post-append callback mechanism in `mmrAuditBridge.js`.

**mmrAuditBridge changes:**
- New export: `registerPostAppendCallback(cb)` — registers a function called `(leafIndex, leafCount)` after every successful MMR append.
- `wireMMRToAuditLog()` now fires all registered callbacks after each append.
- Callbacks are non-fatal: a throwing callback is silently swallowed.

**Server wiring:**
- At startup, `registerPostAppendCallback((_li, lc) => _checkpointScheduler.tick(lc))` is registered.
- Result: checkpoints are now generated automatically every N audit entries, with zero polling.

---

### [V126-P17-03] Nonce + Chain Ops in SDK

`sdk/index.js` gains 7 new methods:

| Method | Description |
|--------|-------------|
| `getNonce(scope, accountId)` | Get current nonce before a nonce-protected call |
| `resolveApproval(id, params)` | Resolve with optional `nonce` field |
| `compactMMR(opts)` | Trigger manual MMR compaction |
| `backfillAuditEntries(opts)` | Backfill pre-V123 audit entries |
| `getCheckpointSchedule()` | Scheduler status |
| `updateCheckpointSchedule(params)` | Change interval / enabled |
| `getCompactionLog(opts)` | Recent compaction events |

`sdk/types.d.ts` gains: `NonceResponse`, `CompactionResult`, `BackfillResult`, `CheckpointScheduleStatus`, `CompactionLogEvent`, and full `EcosClient` type extensions.

---

### [V126-P17-04] Backfill on startup (`AUTO_BACKFILL=true`)

When `AUTO_BACKFILL=true` env var is set and a DB pool is available, the server runs `_auditBackfill.run({ batchSize: 200, maxBatches: 20 })` asynchronously at startup.

- Non-blocking, non-fatal.
- Idempotent: `audit_backfill_log` prevents double-insertion.
- Log line at `INFO` level reports `processed`, `skipped`, `errors`.

---

### [V126-P17-05] Compaction log endpoint

```
GET /api/v1/chain/mmr/compaction/log?limit=20
→ {
    events: [{ id, leaves_archived, leaves_remaining, root_before, root_after, ecos_version, compacted_at }],
    count: number,
    limit: number,
    compactorStats: { threshold, archiveCount, lastCompactAt },
    ecosVersion: 'V126'
  }
```

No auth required (read-only, non-sensitive). Limit capped at 100.

---

### Tests Added

| File | Tests | Coverage |
|------|-------|---------|
| `tests/v126AutoCompact.test.js`         | 4 | callable, fires at threshold, remaining decreases, no-op below threshold |
| `tests/v126MmrBridgeCallback.test.js`   | 3 | callback fires, leafCount increments, throwing callback doesn't break append |
| `tests/v126SdkNonce.test.js`            | 9 | method existence ×7, getNonce URL, resolveApproval body |

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## Migration

No new DB tables. No migration script needed for V126.

If upgrading from V124 directly: run `db/migration_phase15.sql` then `db/migration_phase16.sql`.

---

## New env vars

| Var | Default | Effect |
|-----|---------|--------|
| `AUTO_BACKFILL` | `false` | Run audit backfill at server startup |
| `CHECKPOINT_INTERVAL` | `50` | MMR leaves between auto-checkpoints (already in V125) |

---

## What's Next (V127)

1. **First real user** — technical stack is complete. Deadline: EU AI Act Aug 2, 2026.
2. **Stripe live** — replace mock Stripe with live key for real payment processing.
3. **Hosted demo** — deploy a public demo instance targeting Insurance Claims vertical.
4. **Validator onboarding** — 3-5 vetted domain expert validators with paid contracts.
