# CHANGELOG_V319 — ECOS Canonical Version 319

**Version:** 319.0.0  
**Phase:** P207  
**Date:** 2026-06-02

## Overview

V319 deepens the statistical and semantic analysis layer introduced by V318. It adds
prediction confidence intervals for linear regression forecasts, Z-score-based severity
scoring for page-range outliers, peer-group discovery across the semantic synonym
dictionary, and a dual-window volatility trend comparison.

## Changes

### Core Modules (`src/lib/marketMaker319.js` & `lib/marketMaker319.js`)

- **AuditCapTrail319**: Added `auditCapForecastConfidence319(n, alpha)` which wraps the
  V318 linear regression forecast with prediction intervals. Each forecast step includes
  `lowerCI` and `upperCI` computed via residual standard error and a standard-normal
  critical value. Alpha defaults to 0.05 (95% interval).

- **PageRangeDiffBridge319**: Added `pagedDiffOutlierSeverity319(...)` which extends
  `pagedDiffPageRangeOutliers318` with a per-outlier `severity` field representing the
  Z-score above the outlier threshold. Results are sorted by severity descending.

- **RankedOverlapBuffer319**: Added `semanticGroupExpansion319(token)` which discovers all
  tokens in `SEMANTIC_DICT_318` that share a common group label with the query token (via
  direct synonym lookup and reverse lookup). Returns `groupLabels` (shared labels) and
  `groupPeers` (tokens with their `sharedLabels`).

- **NormDeltaPercentilesTracker319**: Added `trendNormDeltaVolatilityDelta319(...)` which
  calls `trendNormDeltaVolatility318` for two different time windows and returns both
  volatility indices plus a `volatilityDelta` (window1 minus window2). `compareWindowMs`
  defaults to 2× `windowMs`.

### Supporting Exports

- `_normalQuantile319(p)`: Standard-normal quantile approximation (Beasley-Springer-Moro).
  Exported for test verification.

### API Endpoints (Additive)

- `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v319/aggregate/db/hydrate/audit/cap/forecast/confidence`
- `GET  /api/v1/market/alerts/suppress/config/v319/diff/audit/filter/paged/range/outliers/severity`
- `GET  /api/v1/market/backtest/sessions/v319/snapshot/search/ranked/semantic/group/expand`
- `GET  /api/v1/contracts/receipts/v319/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/delta`

### Infrastructure

- `package.json` updated to `319.0.0`.
- `test:v319` script added.
- `tests/v319.test.js` created with 19/19 passing tests.

## Verification

- `node --check` passed for all new modules and server.
- V315 tests: 44/44 passed.
- V316 tests: 12/12 passed.
- V317 tests: 10/10 passed.
- V318 tests: 20/20 passed.
- V319 tests: 19/19 passed.
- Sacred MD5 hashes for `fiatLedger.js` and `auditLog.js` preserved.
