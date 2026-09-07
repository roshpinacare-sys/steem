# NEXT_SESSION_PROMPT_V317.md — Start of V318

## State at V317

- Version `317.0.0`, Phase **P205**.
- New: `marketMaker317` (lib + src/lib mirror) =
  `AuditCapTrail317` (`auditCapHistoryDiff317(cursorA, cursorB)`) +
  `PageRangeDiffBridge317` (`pagedDiffPageRangeHeatmap317(...)`) +
  `RankedOverlapBuffer317` (`multiSearchOverlapFuzzy317(tokens, n)`) +
  `NormDeltaPercentilesTracker317` (`trendNormDeltaAnomalies317(...)`).
- Endpoints (all additive):
  `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v317/aggregate/db/hydrate/audit/cap/history/diff`,
  `GET  /api/v1/market/alerts/suppress/config/v317/diff/audit/filter/paged/range/heatmap`,
  `POST /api/v1/market/backtest/sessions/v317/snapshot/search/ranked/multi/overlap/fuzzy`,
  `GET  /api/v1/contracts/receipts/v317/histogram/rolling/percentiles/trend/delta/cumulative/norm/anomalies`.
- Tests: v315 44/44, v316 12/12, v317 10/10.
- Sacred MD5 unchanged:
  `lib/fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5`,
  `lib/auditLog.js`  `e5a5c2c27801d2d03991bc8e5a1df8cb`.

## Pre-flight (do FIRST in V318)

```bash
node --check ecos-api-server.js
node --check src/lib/marketMaker317.js
node --check lib/marketMaker317.js
NODE_ENV=test node tests/v316.test.js
NODE_ENV=test node tests/v317.test.js
md5sum lib/fiatLedger.js lib/auditLog.js src/lib/fiatLedger.js src/lib/auditLog.js
```

- R1 sacred immutable · `lib/` mirrors `src/lib/` · suffix ids with `318`.
- R3 / R6 no new npm deps · preserve all existing endpoints.
- Ship ONE `ecos_v318_canonical.zip`, root `ecos_v318_canonical/`.

## High-leverage V318 directions

1. **Audit cap forecasting** — Add a method to predict future cap values based on the last N entries using simple linear regression.
2. **Page range outlier detection** — Add a method to identify pages in a range that have entry counts significantly higher than the mean (e.g., > 2 standard deviations).
3. **Overlap semantic match** — Add a method to support basic semantic grouping (e.g., 'apple' and 'fruit') in overlap searches via a predefined local dictionary.
4. **Norm delta volatility index** — Add a method to calculate the standard deviation of normalised deltas across buckets to measure trend volatility.

## Packaging

`ecos_v318_canonical.zip`, root `ecos_v318_canonical/`.
