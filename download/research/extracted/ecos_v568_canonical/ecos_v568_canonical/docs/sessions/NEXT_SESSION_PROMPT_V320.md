# NEXT_SESSION_PROMPT_V320.md — Start of V321

## State at V320

- Version `320.0.0`, Phase **P208**.
- New: `marketMaker320` (lib + src/lib mirror) =
  `AuditCapTrail320` (`auditCapForecastWidening320(n, alpha)`) +
  `PageRangeDiffBridge320` (`pagedDiffCompoundSeverity320(...)`) +
  `RankedOverlapBuffer320` (`semanticSimilarityMatrix320(tokens)`) +
  `NormDeltaPercentilesTracker320` (`trendNormDeltaRegimeClassifier320(...)`).
- Supporting exports: `REGIME_INCREASING_320`, `REGIME_DECREASING_320`, `REGIME_STABLE_320`,
  `_severityEntropy320`.
- Endpoints (all additive):
  `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v320/aggregate/db/hydrate/audit/cap/forecast/confidence/widening`,
  `GET  /api/v1/market/alerts/suppress/config/v320/diff/audit/filter/paged/range/outliers/severity/compound`,
  `POST /api/v1/market/backtest/sessions/v320/snapshot/search/ranked/semantic/similarity/matrix`,
  `GET  /api/v1/contracts/receipts/v320/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime`.
- Tests: v315 44/44, v316 12/12, v317 10/10, v318 20/20, v319 19/19, v320 22/22. Total: 127/127.
- Sacred MD5 unchanged:
  `lib/fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5`,
  `lib/auditLog.js`  `e5a5c2c27801d2d03991bc8e5a1df8cb`.

## Pre-flight (do FIRST in V321)

```bash
node --check ecos-api-server.js
node --check src/lib/marketMaker320.js
node --check lib/marketMaker320.js
NODE_ENV=test node tests/v317.test.js
NODE_ENV=test node tests/v318.test.js
NODE_ENV=test node tests/v319.test.js
NODE_ENV=test node tests/v320.test.js
md5sum lib/fiatLedger.js lib/auditLog.js src/lib/fiatLedger.js src/lib/auditLog.js
```

- R1 sacred immutable · `lib/` mirrors `src/lib/` · suffix ids with `321`.
- R3 / R6 no new npm deps · preserve all existing endpoints.
- Ship ONE `ecos_v321_canonical.zip`, root `ecos_v321_canonical/`.

## High-leverage V321 directions

1. **Forecast accuracy tracking** — Track actual vs. predicted cap values as new entries
   arrive and compute a rolling mean absolute error (MAE) for the forecast model.
2. **Outlier trend detection** — Compare compound severity index across two consecutive
   page range queries and flag if compound severity is increasing over time.
3. **Semantic cluster discovery** — Use the Jaccard similarity matrix (V320) to find
   dense clusters of tokens (connected components above a similarity threshold).
4. **Regime duration tracking** — Track how many consecutive calls the regime has
   remained in the same state and return a `regimeDuration` counter.

## Packaging

`ecos_v321_canonical.zip`, root `ecos_v321_canonical/`.
