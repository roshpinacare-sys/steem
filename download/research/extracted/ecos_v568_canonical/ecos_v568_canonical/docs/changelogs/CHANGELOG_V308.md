# CHANGELOG — V308

**Date:** 2026-06-02
**Phase:** P196
**Version:** 308.0.0

## Summary

Four additive observability enhancements built on top of V307.

## New Components

### 1. AggregateHistory308
- Extends `PersistentPruneHistory307`
- `aggregateHistory308()` — computes summary statistics over the in-memory prune history ring:
  - `totalRuns`, `successRuns`, `errorRuns`
  - `successRate`, `errorRate` (fractions)
  - `totalRows` (sum of all pruned counts)
  - `averageRowsPerRun` (mean over successful runs)
  - `firstRanAt` / `lastRanAt` (ISO timestamps)

### 2. ConfigDiffBridge308
- Extends `VersionedAlertBridge307`
- Overrides `persistConfig307` to snapshot overrides alongside each config version in `_overrideSnapshots308`
- `diffConfigVersions308(vA, vB)` — compares override keys at two version numbers:
  - `added`: keys in vB but not vA
  - `removed`: keys in vA but not vB
  - `changed`: keys in both with different values
- Bounded override snapshot ring (default 50 entries, `opts.versionHistoryCap`)

### 3. SearchableSnapshotBuffer308
- Extends `DiffSnapshotBuffer307`
- `searchSnapshot308(token)` — scans all history entries and returns every index
  where the given session token appears, with `savedAt` and `eventCount` at each snapshot

### 4. PercentilesHistogramTracker308
- Extends `RollingHistogramTracker307`
- `rollingPercentiles308(source, windowMs)` — computes p50/p95/p99 from timestamped
  observations within the rolling window using the nearest-rank method
- `allRollingPercentiles308(windowMs)` — percentiles for every tracked source

## New Endpoints (4 total)

| Method | Path |
|--------|------|
| GET    | `/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v308/aggregate` |
| POST   | `/api/v1/market/alerts/suppress/config/v308/diff` |
| GET    | `/api/v1/market/backtest/sessions/v308/snapshot/search?token=` |
| GET    | `/api/v1/contracts/receipts/v308/histogram/rolling/percentiles?source=&windowMs=` |

## Tests

- `tests/v308.test.js` — 29 tests, 29 passing
- Regression: v305 32/32, v306 36/36, v307 36/36
- `node --check ecos-api-server.js` — clean

## Compliance

- Sacred MD5 unchanged: `fiatLedger.js` `563e9b1f…` / `auditLog.js` `e5a5c2c2…`
- All V287..V307 routes preserved
- Zero new npm dependencies
- All new symbols suffixed `308`
- `lib/marketMaker308.js` mirrored in `src/lib/marketMaker308.js`
- `package.json` bumped to `308.0.0`
