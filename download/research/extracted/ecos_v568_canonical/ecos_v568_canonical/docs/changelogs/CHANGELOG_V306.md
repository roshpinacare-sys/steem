# CHANGELOG — V306

**Date:** 2026-06-02
**Phase:** P194
**Version:** 306.0.0

## Summary

Four additive observability enhancements built on top of V305.

## New Components

### 1. PruneHistoryScheduler306
- Extends `PruneScheduler305`
- Bounded ring (default 50 entries) of historical prune run results
- `pruneHistory306()` — returns entries ordered oldest → newest
- `scheduleInfo306()` — adds `historyCount`/`historyCapacity` to V305 info
- Ring auto-evicts oldest when capacity exceeded
- Env: `ECOS_PRUNE_INTERVAL_MS_V305` still respected (inherited)

### 2. PersistentAlertBridge306
- Extends `AdaptiveAlertBridge305`
- `persistConfig306(pool)` — upserts `_overrides305` map to `ecos_alert_suppress_config` table
- `loadConfig306(pool)` — reads table rows and merges into in-memory overrides
- `getPersistedConfig306()` — returns current in-memory state
- `setDb306(db)` — convenience method for setting pool reference
- DB table auto-created on first persist/load call (non-fatal if unavailable)

### 3. VersionedSnapshotBuffer306
- Extends `SnapshotSessionBuffer305`
- `snapshotSessions306()` — takes V305 snapshot and also pushes to history ring
- `snapshotHistory306()` — returns `{ index, savedAt, sessions }` per entry
- `restoreFromHistory306(index)` — restores metadata from a past snapshot entry
- History ring default capacity: 10; configurable via `opts.historyCapacity`
- Schema guard: `SNAPSHOT_HISTORY_VERSION_306 = '306-snapshot'`

### 4. ResettableHistogramTracker306
- Extends `HistogramLatencyTracker305`
- `resetHistogram306(source?)` — clears buckets for one source or all sources
- `resetStats306()` — returns `{ totalResets, sourceResets, globalResets }`
- Resetting a non-existent source creates and initialises it (returns `created: true`)
- `null` argument treated as global reset (all sources cleared)

## New Endpoints (10 total)

| Method | Path                                                                         |
|--------|------------------------------------------------------------------------------|
| GET    | `/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v306`        |
| GET    | `/api/v1/market/treasury/hitl/webhook/deliveries/prune/schedule/v306`       |
| GET    | `/api/v1/market/alerts/suppress/config/v306`                                |
| POST   | `/api/v1/market/alerts/suppress/config/v306`                                |
| GET    | `/api/v1/market/backtest/sessions/v306/snapshot/history`                    |
| POST   | `/api/v1/market/backtest/sessions/v306/snapshot`                            |
| POST   | `/api/v1/market/backtest/sessions/v306/snapshot/restore`                    |
| POST   | `/api/v1/contracts/receipts/v306/histogram/reset`                           |
| GET    | `/api/v1/contracts/receipts/v306/histogram`                                 |
| GET    | `/api/v1/admin/summary/v306`                                                |

## Tests

- `tests/v306.test.js` — 36 tests, 36 passing
- `node --check ecos-api-server.js` — clean

## Compliance

- Sacred MD5 unchanged: `fiatLedger.js` `563e9b1f…` / `auditLog.js` `e5a5c2c2…`
- All V287..V305 routes preserved
- Zero new npm dependencies
- All new symbols suffixed `306`
