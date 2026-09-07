# NEXT_SESSION_PROMPT_V319.md — Start of V320

## State at V319

- Version `319.0.0`, Phase **P207**.
- New: `marketMaker319` (lib + src/lib mirror) =
  `AuditCapTrail319` (`auditCapForecastConfidence319(n, alpha)`) +
  `PageRangeDiffBridge319` (`pagedDiffOutlierSeverity319(...)`) +
  `RankedOverlapBuffer319` (`semanticGroupExpansion319(token)`) +
  `NormDeltaPercentilesTracker319` (`trendNormDeltaVolatilityDelta319(...)`).
- Supporting exports: `_normalQuantile319(p)`.
- Endpoints (all additive):
  `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v319/aggregate/db/hydrate/audit/cap/forecast/confidence`,
  `GET  /api/v1/market/alerts/suppress/config/v319/diff/audit/filter/paged/range/outliers/severity`,
  `GET  /api/v1/market/backtest/sessions/v319/snapshot/search/ranked/semantic/group/expand`,
  `GET  /api/v1/contracts/receipts/v319/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/delta`.
- Tests: v315 44/44, v316 12/12, v317 10/10, v318 20/20, v319 19/19.
- Sacred MD5 unchanged:
  `lib/fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5`,
  `lib/auditLog.js`  `e5a5c2c27801d2d03991bc8e5a1df8cb`.

## Pre-flight (do FIRST in V320)

```bash
node --check ecos-api-server.js
node --check src/lib/marketMaker319.js
node --check lib/marketMaker319.js
NODE_ENV=test node tests/v316.test.js
NODE_ENV=test node tests/v317.test.js
NODE_ENV=test node tests/v318.test.js
NODE_ENV=test node tests/v319.test.js
md5sum lib/fiatLedger.js lib/auditLog.js src/lib/fiatLedger.js src/lib/auditLog.js
```

- R1 sacred immutable · `lib/` mirrors `src/lib/` · suffix ids with `320`.
- R3 / R6 no new npm deps · preserve all existing endpoints.
- Ship ONE `ecos_v320_canonical.zip`, root `ecos_v320_canonical/`.

## High-leverage V320 directions

1. **Multi-step confidence bands** — Extend the V319 forecast confidence model with
   widening bands for steps further into the future (variance grows with forecast horizon).
2. **Compound severity index** — Aggregate all outlier severity scores into a single
   composite index per page range query (e.g. sum, max, or entropy of severity scores).
3. **Semantic similarity matrix** — Build a pairwise similarity matrix over all tokens in
   `SEMANTIC_DICT_318`, with Jaccard similarity based on shared group labels.
4. **Volatility regime classifier** — Use the volatility delta from V319 to classify the
   market regime as "stable", "increasing", or "decreasing" volatility with thresholds.

## Packaging

`ecos_v320_canonical.zip`, root `ecos_v320_canonical/`.
