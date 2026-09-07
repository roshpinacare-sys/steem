# CHANGELOG — V307

**Date:** 2026-06-02
**Phase:** P195
**Version:** 307.0.0

## Summary

Four additive observability enhancements built on top of V306.

## New Components

### 1. PersistentPruneHistory307
- Extends `PruneHistoryScheduler306`
- `flushHistory307(pool)` — persists in-memory prune history ring to `ecos_prune_history` table
- `loadHistory307(pool)` — reads rows back and restores the in-memory ring (ordered by ran_at ASC, capped at historyCapacity)
- `historyStats307()` — exposes `{ flushCalls, loadCalls, errors, version }`
- DB table auto-created on first flush/load call (non-fatal if unavailable)
- Schema: `(id BIGSERIAL, ran_at TIMESTAMPTZ, ok BOOLEAN, pruned INT, older_than TEXT, error_msg TEXT, version TEXT)`

### 2. VersionedAlertBridge307
- Extends `PersistentAlertBridge306`
- `persistConfig307(pool, updatedBy?)` — bumps `config_version` counter, records `updatedBy`, then persists via parent
- `getConfigVersion307()` — returns `{ configVersion, updatedBy, overrides, versionHistory, version }`
- Bounded version history ring (default 50 entries, `opts.versionHistoryCap`)
- DB columns `config_version` and `updated_by` added via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (non-fatal)

### 3. DiffSnapshotBuffer307
- Extends `VersionedSnapshotBuffer306`
- `diffSnapshots307(indexA, indexB)` — compares two snapshot history entries by session token
  - `added`: tokens in B but not A
  - `removed`: tokens in A but not B
  - `changed`: tokens in both but with different `eventCount`
  - `unchanged`: count of tokens identical in both snapshots
- Returns `{ ok, indexA, indexB, savedAtA, savedAtB, added, removed, changed, unchanged, version }`

### 4. RollingHistogramTracker307
- Extends `ResettableHistogramTracker306`
- Overrides `query304` to record `{ ts, latencyMs }` in a per-source timestamped observation buffer
- `rollingHistogram307(source, windowMs)` — returns histogram data only for observations within the last `windowMs` ms
- `allRollingHistograms307(windowMs)` — rolling histogram for every tracked source
- Buffer capped at `maxObsCap` (default 10,000 per source)

## New Endpoints (6 total)

| Method | Path                                                                                    |
|--------|-----------------------------------------------------------------------------------------|
| GET    | `/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v307/db`                |
| GET    | `/api/v1/market/alerts/suppress/config/v307/version`                                   |
| POST   | `/api/v1/market/alerts/suppress/config/v307/version`                                   |
| POST   | `/api/v1/market/backtest/sessions/v307/snapshot/diff`                                  |
| GET    | `/api/v1/contracts/receipts/v307/histogram/rolling?source=&windowMs=`                  |
| GET    | `/api/v1/admin/summary/v307`                                                            |

## Tests

- `tests/v307.test.js` — 36 tests, 36 passing
- Regression: v305 32/32, v306 36/36
- `node --check ecos-api-server.js` — clean

## Compliance

- Sacred MD5 unchanged: `fiatLedger.js` `563e9b1f…` / `auditLog.js` `e5a5c2c2…`
- All V287..V306 routes preserved
- Zero new npm dependencies
- All new symbols suffixed `307`
- `lib/marketMaker307.js` mirrored in `src/lib/marketMaker307.js`
- `package.json` bumped to `307.0.0`
