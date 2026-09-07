# NEXT_SESSION_PROMPT_V315.md — Start of V316

## State at V315

- Version `315.0.0`, Phase **P203**.
- New: `marketMaker315` (lib + src/lib mirror) =
  `AuditCapTrail315` (`auditCapHistoryPaged315(page,pageSize)`; paginated V314 cap history; returns `totalCount`, `totalPages`, `hasNextPage`) +
  `PageRangeDiffBridge315` (`pagedDiffPageRangeStats315(from,to,startPage,endPage,pageSize)`; V314 range response plus `perPage: [{ page, entryCount }]`) +
  `RankedOverlapBuffer315` (`multiSearchOverlapTopN315(tokens[],n)`; returns top-N from V314 ranked overlap; default n=10) +
  `NormDeltaPercentilesTracker315` (`trendNormDeltaStats315(source,windowMs,buckets,baseline)`; V314 normalised cumulative deltas plus `{ minNorm, maxNorm, meanNorm, rangeNorm }`).
- Endpoints (all additive):
  `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v315/aggregate/db/hydrate/audit/cap/history/paged?page=&pageSize=`,
  `GET  /api/v1/market/alerts/suppress/config/v315/diff/audit/filter/paged/range/stats?from=&to=&startPage=&endPage=&pageSize=`,
  `POST /api/v1/market/backtest/sessions/v315/snapshot/search/ranked/multi/overlap/top?n=`,
  `GET  /api/v1/contracts/receipts/v315/histogram/rolling/percentiles/trend/delta/cumulative/norm/stats?source=&windowMs=&buckets=&baseline=`.
  All V287..V314 routes preserved.
- Tests: v313 39/39, v314 42/42, v315 44/44.
- Sacred MD5 unchanged:
  `lib/fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5`,
  `lib/auditLog.js`  `e5a5c2c27801d2d03991bc8e5a1df8cb`,
  with matching `src/lib` mirrors.

## Pre-flight (do FIRST in V316)

```bash
node --check ecos-api-server.js
node --check src/lib/marketMaker315.js
node --check lib/marketMaker315.js
NODE_ENV=test node tests/v314.test.js
NODE_ENV=test node tests/v315.test.js
md5sum lib/fiatLedger.js lib/auditLog.js src/lib/fiatLedger.js src/lib/auditLog.js
```

- R1 sacred immutable · `lib/` mirrors `src/lib/` · suffix ids with `316`.
- R3 / R6 no new npm deps · preserve all existing endpoints.
- Ship ONE `ecos_v316_canonical.zip`, root `ecos_v316_canonical/`.

## High-leverage V316 directions

1. **Cap history cursor pagination** — V315 supports page/pageSize pagination. Add cursor-based retrieval using `changedAt` or ring index so clients can resume from a known event without page drift. Suggested method: `auditCapHistoryCursor316(cursor, limit)` returning `{ entries, nextCursor, hasNextPage }`.

2. **Page range stats totals** — V315 adds `perPage`. Add aggregate range-level stats such as `nonEmptyPages`, `emptyPages`, `maxPageEntryCount`, and `meanPageEntryCount`. Suggested method: `pagedDiffPageRangeSummary316(...)`.

3. **Overlap top-N explainability** — V315 returns top-N entries. Add an explanation payload per result that includes which requested tokens matched and the match ratio. Suggested method: `multiSearchOverlapTopExplain316(tokens[], n)`.

4. **Norm delta threshold classification** — V315 computes global stats. Add threshold labels for buckets such as `stable`, `elevated`, and `spike` based on configurable normDelta thresholds. Suggested method: `trendNormDeltaClassified316(source, windowMs, buckets, baseline, thresholds)`.

## Packaging

`ecos_v316_canonical.zip`, root `ecos_v316_canonical/`.
