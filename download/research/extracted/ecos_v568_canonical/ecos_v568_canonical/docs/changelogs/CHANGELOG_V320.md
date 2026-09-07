# CHANGELOG_V320 — ECOS Canonical Version 320

**Version:** 320.0.0  
**Phase:** P208  
**Date:** 2026-06-02

## Overview

V320 extends the statistical and semantic capabilities of V319 with four new analytical
features: horizon-widening forecast confidence bands, a compound severity aggregate index,
a pairwise Jaccard semantic similarity matrix, and a volatility regime classifier.

## Changes

### Core Modules (`src/lib/marketMaker320.js` & `lib/marketMaker320.js`)

- **AuditCapTrail320**: Added `auditCapForecastWidening320(n, alpha)` which wraps the V319
  confidence intervals and adds a per-step widening increment proportional to
  `tCrit * residualSE / sqrt(N) * step`. Each forecast item carries a `halfWidth` field.
  Bands are non-decreasing across forecast steps.

- **PageRangeDiffBridge320**: Added `pagedDiffCompoundSeverity320(...)` which extends
  `pagedDiffOutlierSeverity319` with a `compoundSeverity` object containing `sum`, `max`,
  Shannon `entropy`, and `count` of all outlier severity scores.

- **RankedOverlapBuffer320**: Added `semanticSimilarityMatrix320(tokens)` which builds a
  pairwise Jaccard similarity matrix over the supplied token list using group label
  expansions from `SEMANTIC_DICT_318`. Result is sorted by `jaccard` descending.

- **NormDeltaPercentilesTracker320**: Added `trendNormDeltaRegimeClassifier320(...)` which
  uses the V319 volatility delta to classify the market regime as `"increasing"`,
  `"decreasing"`, or `"stable"` with configurable thresholds (default 0.05).

### Supporting Exports

- `REGIME_INCREASING_320`, `REGIME_DECREASING_320`, `REGIME_STABLE_320`: regime constants.
- `_severityEntropy320(values)`: Shannon entropy helper (exported for testing).

### API Endpoints (Additive)

- `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v320/aggregate/db/hydrate/audit/cap/forecast/confidence/widening`
- `GET  /api/v1/market/alerts/suppress/config/v320/diff/audit/filter/paged/range/outliers/severity/compound`
- `POST /api/v1/market/backtest/sessions/v320/snapshot/search/ranked/semantic/similarity/matrix`
- `GET  /api/v1/contracts/receipts/v320/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime`

### Infrastructure

- `package.json` updated to `320.0.0`.
- `test:v320` script added.
- `tests/v320.test.js` created with 22/22 passing tests.

## Verification

- `node --check` passed for all new modules and server.
- V315 tests: 44/44 passed.
- V316 tests: 12/12 passed.
- V317 tests: 10/10 passed.
- V318 tests: 20/20 passed.
- V319 tests: 19/19 passed.
- V320 tests: 22/22 passed.
- Sacred MD5 hashes for `fiatLedger.js` and `auditLog.js` preserved.
