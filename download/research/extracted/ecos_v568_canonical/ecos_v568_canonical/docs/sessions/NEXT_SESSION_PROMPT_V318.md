# NEXT_SESSION_PROMPT_V318.md — Start of V319

## State at V318

- Version `318.0.0`, Phase **P206**.
- New: `marketMaker318` (lib + src/lib mirror) =
  `AuditCapTrail318` (`auditCapForecast318(n)`) +
  `PageRangeDiffBridge318` (`pagedDiffPageRangeOutliers318(...)`) +
  `RankedOverlapBuffer318` (`multiSearchOverlapSemantic318(tokens, n)`) +
  `NormDeltaPercentilesTracker318` (`trendNormDeltaVolatility318(...)`).
- Supporting exports: `SEMANTIC_DICT_318`, `_expandSemantic318(token)`.
- Endpoints (all additive):
  `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v318/aggregate/db/hydrate/audit/cap/forecast`,
  `GET  /api/v1/market/alerts/suppress/config/v318/diff/audit/filter/paged/range/outliers`,
  `POST /api/v1/market/backtest/sessions/v318/snapshot/search/ranked/multi/overlap/semantic`,
  `GET  /api/v1/contracts/receipts/v318/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility`.
- Tests: v315 44/44, v316 12/12, v317 10/10, v318 20/20.
- Sacred MD5 unchanged:
  `lib/fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5`,
  `lib/auditLog.js`  `e5a5c2c27801d2d03991bc8e5a1df8cb`.

## Pre-flight (do FIRST in V319)

```bash
node --check ecos-api-server.js
node --check src/lib/marketMaker318.js
node --check lib/marketMaker318.js
NODE_ENV=test node tests/v316.test.js
NODE_ENV=test node tests/v317.test.js
NODE_ENV=test node tests/v318.test.js
md5sum lib/fiatLedger.js lib/auditLog.js src/lib/fiatLedger.js src/lib/auditLog.js
```

- R1 sacred immutable · `lib/` mirrors `src/lib/` · suffix ids with `319`.
- R3 / R6 no new npm deps · preserve all existing endpoints.
- Ship ONE `ecos_v319_canonical.zip`, root `ecos_v319_canonical/`.

## High-leverage V319 directions

1. **Forecast confidence intervals** — Add a method to compute confidence intervals around the V318 linear regression forecast (e.g., using residual standard error).
2. **Outlier severity scoring** — Add a method to score each outlier page by its distance above the threshold as a multiple of the standard deviation.
3. **Semantic dictionary expansion** — Add a method to return all tokens in the semantic dictionary that share a common group label with a given query token.
4. **Volatility trend** — Add a method to compare the volatility index across two different time windows and return the delta as a trend indicator.

## Packaging

`ecos_v319_canonical.zip`, root `ecos_v319_canonical/`.
