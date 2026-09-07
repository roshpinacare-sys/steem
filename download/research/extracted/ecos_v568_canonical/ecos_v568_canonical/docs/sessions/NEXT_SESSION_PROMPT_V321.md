# NEXT_SESSION_PROMPT_V321.md — Start of V322

## State at V321

- Version `321.0.0`, Phase **P209**.
- New: `marketMaker321` (lib + src/lib mirror) =
  `AuditCapTrail321` (`recordActual321`, `auditCapForecastMAE321(maxEntries)`) +
  `PageRangeDiffBridge321` (`pagedDiffCompoundSeverityTrend321(...)`) +
  `RankedOverlapBuffer321` (`semanticClusterDiscovery321(tokens, threshold)`) +
  `NormDeltaPercentilesTracker321` (`trendNormDeltaRegimeDuration321(...)`, `resetRegimeDuration321()`).
- Supporting exports: `_UnionFind321`, `SEVERITY_TREND_*_321` constants.
- Endpoints (all additive):
  `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v321/aggregate/db/hydrate/audit/cap/forecast/mae`,
  `GET  /api/v1/market/alerts/suppress/config/v321/diff/audit/filter/paged/range/outliers/severity/trend`,
  `POST /api/v1/market/backtest/sessions/v321/snapshot/search/ranked/semantic/clusters`,
  `GET  /api/v1/contracts/receipts/v321/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/duration`.
- Tests: v315 44/44, v316 12/12, v317 10/10, v318 20/20, v319 19/19, v320 22/22, v321 22/22. Total: 149/149.
- Sacred MD5 unchanged:
  `lib/fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5`,
  `lib/auditLog.js`  `e5a5c2c27801d2d03991bc8e5a1df8cb`.

## Pre-flight (do FIRST in V322)

```bash
node --check ecos-api-server.js
node --check src/lib/marketMaker321.js
node --check lib/marketMaker321.js
NODE_ENV=test node tests/v318.test.js
NODE_ENV=test node tests/v319.test.js
NODE_ENV=test node tests/v320.test.js
NODE_ENV=test node tests/v321.test.js
md5sum lib/fiatLedger.js lib/auditLog.js src/lib/fiatLedger.js src/lib/auditLog.js
```

- R1 sacred immutable · `lib/` mirrors `src/lib/` · suffix ids with `322`.
- R3 / R6 no new npm deps · preserve all existing endpoints.
- Ship ONE `ecos_v322_canonical.zip`, root `ecos_v322_canonical/`.

## High-leverage V322 directions

1. **MAE trend alerting** — Extend the V321 MAE tracker to emit an alert flag when the
   MAE exceeds a configurable threshold, indicating the forecast model has degraded.
2. **Severity anomaly burst detection** — Extend the severity trend (V321) to detect a
   "burst" when severity delta crosses a high-water mark within a short rolling window.
3. **Cluster stability tracking** — Compare two consecutive `semanticClusterDiscovery321`
   results and return a diff: which tokens moved clusters, merged, or split.
4. **Regime transition matrix** — Track the full transition history of regime changes
   and return a matrix counting how often each regime transitions to another.

## Packaging

`ecos_v322_canonical.zip`, root `ecos_v322_canonical/`.
