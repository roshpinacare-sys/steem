# NEXT_SESSION_PROMPT_V314.md — Start of V315

## State at V314
- Version `314.0.0`, Phase **P202**.
- New: `marketMaker314` (lib + src/lib mirror) =
  `AuditCapTrail314` (auditCapHistory314(); bounded ring 50; {changedAt,cap,previousCap}; records only on success) +
  `PageRangeDiffBridge314` (pagedDiffPageRange314(from,to,startPage,endPage,pageSize); concat pages; empty when endPage<startPage) +
  `RankedOverlapBuffer314` (multiSearchOverlapRanked314(tokens[]); sharedSnapshots sorted by matchCount desc) +
  `NormDeltaPercentilesTracker314` (trendCumulativeDeltaNorm314(source,windowMs,buckets,baseline); normDelta=cumulativeP99Delta/referenceP99; null when ref 0 or null).
- Endpoints (all additive):
  `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v314/aggregate/db/hydrate/audit/cap/history`,
  `GET  /api/v1/market/alerts/suppress/config/v314/diff/audit/filter/paged/range?from=&to=&startPage=&endPage=&pageSize=`,
  `POST /api/v1/market/backtest/sessions/v314/snapshot/search/ranked/multi/overlap/ranked`,
  `GET  /api/v1/contracts/receipts/v314/histogram/rolling/percentiles/trend/delta/cumulative/norm?source=&windowMs=&buckets=&baseline=`.
  All V287..V313 routes preserved.
- Tests: v312 41/41, v313 39/39, v314 42/42.
- Sacred MD5 unchanged:
  `lib/fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5`,
  `lib/auditLog.js`  `e5a5c2c27801d2d03991bc8e5a1df8cb`.

## ⚠️ Pre-flight (do FIRST in V315)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v313.test.js
NODE_ENV=test node tests/v314.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f… / e5a5c2c2…
```
- R1 sacred immutable · `lib/` mirrors `src/lib/` · suffix ids with `315`
- R3 / R6 no new npm deps · R6 preserve all existing endpoints
- Ship ONE `ecos_v315_canonical.zip`, root `ecos_v315_canonical/`

## High-leverage V315 directions

1. **Cap history pagination** — `AuditCapTrail314.auditCapHistory314` returns all entries
   at once. Add `auditCapHistoryPaged315(page, pageSize)` that returns a paginated slice
   of the history ring with `totalCount`, `totalPages`, `hasNextPage`.
   Expose `GET /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v315/aggregate/db/hydrate/audit/cap/history/paged?page=&pageSize=`.

2. **Page range entry count** — `PageRangeDiffBridge314.pagedDiffPageRange314` returns
   concatenated entries but no per-page breakdown. Add `pagedDiffPageRangeStats315(fromVersion,
   toVersion, startPage, endPage, pageSize)` that returns the same data plus a `perPage`
   array `[{ page, entryCount }]` for each page in the range.
   Expose `GET /api/v1/market/alerts/suppress/config/v315/diff/audit/filter/paged/range/stats?from=&to=&startPage=&endPage=&pageSize=`.

3. **Overlap ranked top-N** — `RankedOverlapBuffer314.multiSearchOverlapRanked314` returns
   all ranked results. Add `multiSearchOverlapTopN315(tokens[], n)` that returns only the
   top-N entries by matchCount (n defaults to 10, min 1).
   Expose `POST /api/v1/market/backtest/sessions/v315/snapshot/search/ranked/multi/overlap/top?n=`
   (body `{ tokens: [...] }`).

4. **Norm delta statistics** — `NormDeltaPercentilesTracker314.trendCumulativeDeltaNorm314`
   returns per-bucket normDelta values. Add `trendNormDeltaStats315(source, windowMs, buckets,
   baselineBucket)` that additionally computes global stats across all non-null normDelta
   values: `{ minNorm, maxNorm, meanNorm, rangeNorm }`.
   Expose `GET /api/v1/contracts/receipts/v315/histogram/rolling/percentiles/trend/delta/cumulative/norm/stats?source=&windowMs=&buckets=&baseline=`.

## Packaging
`ecos_v315_canonical.zip`, root `ecos_v315_canonical/`.
