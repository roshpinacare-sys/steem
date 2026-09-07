# NEXT_SESSION_PROMPT_V316.md — Start of V317

## State at V316

- Version `316.0.0`, Phase **P204**.
- New: `marketMaker316` (lib + src/lib mirror) =
  `AuditCapTrail316` (`auditCapHistoryCursor316(cursor, limit)`) +
  `PageRangeDiffBridge316` (`pagedDiffPageRangeSummary316(...)`) +
  `RankedOverlapBuffer316` (`multiSearchOverlapTopExplain316(tokens, n)`) +
  `NormDeltaPercentilesTracker316` (`trendNormDeltaClassified316(...)`).
- Endpoints (all additive):
  `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v316/aggregate/db/hydrate/audit/cap/history/cursor`,
  `GET  /api/v1/market/alerts/suppress/config/v316/diff/audit/filter/paged/range/summary`,
  `POST /api/v1/market/backtest/sessions/v316/snapshot/search/ranked/multi/overlap/explain`,
  `GET  /api/v1/contracts/receipts/v316/histogram/rolling/percentiles/trend/delta/cumulative/norm/classified`.
- Tests: v314 42/42, v315 44/44, v316 12/12.
- Sacred MD5 unchanged:
  `lib/fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5`,
  `lib/auditLog.js`  `e5a5c2c27801d2d03991bc8e5a1df8cb`.

## Pre-flight (do FIRST in V317)

```bash
node --check ecos-api-server.js
node --check src/lib/marketMaker316.js
node --check lib/marketMaker316.js
NODE_ENV=test node tests/v315.test.js
NODE_ENV=test node tests/v316.test.js
md5sum lib/fiatLedger.js lib/auditLog.js src/lib/fiatLedger.js src/lib/auditLog.js
```

- R1 sacred immutable · `lib/` mirrors `src/lib/` · suffix ids with `317`.
- R3 / R6 no new npm deps · preserve all existing endpoints.
- Ship ONE `ecos_v317_canonical.zip`, root `ecos_v317_canonical/`.

## High-leverage V317 directions

1. **Audit cap diffing** — Add a method to compare two cap history entries by cursor or index and return a structured diff of the cap changes.
2. **Page range heatmap** — Add a method to return a heatmap representation (array of intensities) for entry counts across a page range.
3. **Overlap fuzzy match** — Add a method to support fuzzy token matching in overlap searches using a simple Levenshtein distance or substring check.
4. **Norm delta anomaly detection** — Add a method to identify specific buckets that exceed the `spike` threshold and return them as an anomaly list.

## Packaging

`ecos_v317_canonical.zip`, root `ecos_v317_canonical/`.
