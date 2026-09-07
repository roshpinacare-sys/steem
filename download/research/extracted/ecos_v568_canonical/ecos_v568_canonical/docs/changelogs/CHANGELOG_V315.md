# CHANGELOG — V315

**Date:** 2026-06-02  
**Phase:** P203  
**Version:** 315.0.0

## Summary

V315 adds four additive observability and API refinements on top of V314. The release keeps the V287..V314 surface area intact and focuses on bounded pagination, page-level statistics, deterministic top-N ranked overlap retrieval, and aggregate statistics for normalised cumulative deltas.

## New Components

### 1. AuditCapTrail315

- Extends `AuditCapTrail314`.
- `auditCapHistoryPaged315(page, pageSize)` returns a paginated slice of the V314 cap-change history ring.
- Response includes `page`, `pageSize`, `entries`, `count`, `totalCount`, `totalPages`, and `hasNextPage`.
- `page` defaults to 1; `pageSize` defaults to 20 and is capped at 200.
- Endpoint: `GET /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v315/aggregate/db/hydrate/audit/cap/history/paged?page=&pageSize=`.

### 2. PageRangeDiffBridge315

- Extends `PageRangeDiffBridge314`.
- `pagedDiffPageRangeStats315(fromVersion, toVersion, startPage, endPage, pageSize)` returns the V314 concatenated range result plus a `perPage` array.
- `perPage` entries use the shape `{ page, entryCount }` and cover each effective page in the requested range.
- Inverted ranges preserve the V314 empty result and return `perPage: []`.
- Endpoint: `GET /api/v1/market/alerts/suppress/config/v315/diff/audit/filter/paged/range/stats?from=&to=&startPage=&endPage=&pageSize=`.

### 3. RankedOverlapBuffer315

- Extends `RankedOverlapBuffer314`.
- `multiSearchOverlapTopN315(tokens[], n)` returns only the top-N entries from the V314 ranked overlap result.
- `n` defaults to 10 and invalid values are normalised to 10 while preserving a minimum effective limit of 1 for valid positive integers.
- Response includes `sharedSnapshots`, `n`, `totalCount`, and `version`.
- Endpoint: `POST /api/v1/market/backtest/sessions/v315/snapshot/search/ranked/multi/overlap/top?n=` with body `{ "tokens": [...] }`.

### 4. NormDeltaPercentilesTracker315

- Extends `NormDeltaPercentilesTracker314`.
- `trendNormDeltaStats315(source, windowMs, buckets, baselineBucket)` returns the V314 normalised cumulative delta output and adds `normDeltaStats`.
- `normDeltaStats` is computed across all finite, non-null `normDelta` values and has the shape `{ minNorm, maxNorm, meanNorm, rangeNorm }`.
- If no finite non-null values are available, all four stats are `null`.
- Endpoint: `GET /api/v1/contracts/receipts/v315/histogram/rolling/percentiles/trend/delta/cumulative/norm/stats?source=&windowMs=&buckets=&baseline=`.

## New Endpoints

| Method | Path |
|---|---|
| GET | `/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v315/aggregate/db/hydrate/audit/cap/history/paged?page=&pageSize=` |
| GET | `/api/v1/market/alerts/suppress/config/v315/diff/audit/filter/paged/range/stats?from=&to=&startPage=&endPage=&pageSize=` |
| POST | `/api/v1/market/backtest/sessions/v315/snapshot/search/ranked/multi/overlap/top?n=` |
| GET | `/api/v1/contracts/receipts/v315/histogram/rolling/percentiles/trend/delta/cumulative/norm/stats?source=&windowMs=&buckets=&baseline=` |

## Tests

- `tests/v313.test.js` — 39 tests passing.
- `tests/v314.test.js` — 42 tests passing.
- `tests/v315.test.js` — 44 tests passing.
- `node --check src/lib/marketMaker315.js` — clean.
- `node --check lib/marketMaker315.js` — clean.
- `node --check ecos-api-server.js` — clean.

## Compliance

- Sacred MD5 unchanged: `fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5` / `auditLog.js` `e5a5c2c27801d2d03991bc8e5a1df8cb`.
- All V287..V314 routes and modules are preserved.
- Zero new npm dependencies.
- All new public identifiers are suffixed `315`.
- `lib/marketMaker315.js` is mirrored from `src/lib/marketMaker315.js`.
- `package.json` version bumped to `315.0.0` and `test:v315` added.
