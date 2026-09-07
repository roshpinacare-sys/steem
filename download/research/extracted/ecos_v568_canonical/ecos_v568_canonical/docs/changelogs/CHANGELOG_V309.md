# CHANGELOG — V309

**Date:** 2026-06-02
**Phase:** P197
**Version:** 309.0.0

## Summary

Four additive observability enhancements built on top of V308.

## New Components

### 1. PersistedAggregateHistory309
- Extends `AggregateHistory308`
- `persistAggregate309(pool)` — upserts the current aggregate snapshot to
  `ecos_prune_aggregate` DB table (single-row keyed on `'singleton'`).
  Table auto-created on first call (non-fatal if DB unavailable).
  Resolves always; non-fatal on error.
- `aggregatePersistStats309()` — exposes `{ persistCalls, errors, version }`

### 2. AutoDiffBridge309
- Extends `ConfigDiffBridge308`
- `autoDiff309` flag (default `false`): when `true`, calls `diffConfigVersions308`
  between the previous and new config version on each `persistConfig307` call,
  storing the result in bounded ring `_diffAudit309`
- `_diffAuditCap309` (default 100): max entries in the audit ring
- `getDiffAudit309()` — returns all entries in the diff audit ring:
  `{ fromVersion, toVersion, diff, recordedAt, version }`

### 3. RankedSnapshotBuffer309
- Extends `SearchableSnapshotBuffer308`
- `rankedSearch309(token)` — same as `searchSnapshot308(token)` but results are
  sorted by `eventCount` descending so the most-active snapshots appear first

### 4. TrendPercentilesTracker309
- Extends `PercentilesHistogramTracker308`
- `percentileTrend309(source, windowMs, buckets)` — splits the rolling window
  into `buckets` equal sub-windows (default 5) and returns p50/p95/p99 for each:
  `[{ bucketIndex, from, to, count, p50, p95, p99 }, ...]`

## New Endpoints (4 total)

| Method | Path |
|--------|------|
| GET    | `/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v309/aggregate/db` |
| GET    | `/api/v1/market/alerts/suppress/config/v309/diff/audit` |
| GET    | `/api/v1/market/backtest/sessions/v309/snapshot/search/ranked?token=` |
| GET    | `/api/v1/contracts/receipts/v309/histogram/rolling/percentiles/trend?source=&windowMs=&buckets=` |

## Tests

- `tests/v309.test.js` — 32 tests, 32 passing
- Regression: v306 36/36, v307 36/36, v308 29/29
- `node --check lib/marketMaker309.js` — clean

## Compliance

- Sacred MD5 unchanged: `fiatLedger.js` `563e9b1f…` / `auditLog.js` `e5a5c2c2…`
- All V287..V308 routes preserved
- Zero new npm dependencies
- All new symbols suffixed `309`
- `lib/marketMaker309.js` mirrored in `src/lib/marketMaker309.js`
- `package.json` bumped to `309.0.0`
