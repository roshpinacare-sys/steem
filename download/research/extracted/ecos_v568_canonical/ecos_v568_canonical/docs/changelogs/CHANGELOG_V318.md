# CHANGELOG_V318 — ECOS Canonical Version 318

**Version:** 318.0.0  
**Phase:** P206  
**Date:** 2026-06-02

## Overview

V318 introduces predictive and statistical analysis features on top of the V317 layer. Key additions include linear regression-based cap value forecasting, outlier detection for page range entry density, semantic token expansion for overlap searches using a predefined synonym dictionary, and a volatility index for normalised cumulative deltas.

## Changes

### Core Modules (`src/lib/marketMaker318.js` & `lib/marketMaker318.js`)

- **AuditCapTrail318**: Added `auditCapForecast318(n)` which applies simple linear regression to the cap history and returns predicted future cap values with slope and intercept.
- **PageRangeDiffBridge318**: Added `pagedDiffPageRangeOutliers318(...)` which identifies pages whose entry counts exceed the mean by more than 2 standard deviations (configurable via `stdFactor`).
- **RankedOverlapBuffer318**: Added `multiSearchOverlapSemantic318(tokens, n)` which expands query tokens via `SEMANTIC_DICT_318` (local synonym dictionary) before performing substring overlap matching. Includes reverse-lookup support.
- **NormDeltaPercentilesTracker318**: Added `trendNormDeltaVolatility318(...)` which computes the population standard deviation of all finite `normDelta` values as a volatility index.

### Supporting Exports

- `SEMANTIC_DICT_318`: Built-in synonym dictionary covering common word groups (fruit, animals, vehicles, etc.).
- `_expandSemantic318(token)`: Helper that expands a single token to include all direct and reverse-lookup synonyms.

### API Endpoints (Additive)

- `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v318/aggregate/db/hydrate/audit/cap/forecast`
- `GET  /api/v1/market/alerts/suppress/config/v318/diff/audit/filter/paged/range/outliers`
- `POST /api/v1/market/backtest/sessions/v318/snapshot/search/ranked/multi/overlap/semantic`
- `GET  /api/v1/contracts/receipts/v318/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility`

### Infrastructure

- `package.json` updated to `318.0.0`.
- `test:v318` script added.
- `tests/v318.test.js` created with 20/20 passing tests.

## Verification

- `node --check` passed for all new modules and server.
- V315 tests: 44/44 passed.
- V316 tests: 12/12 passed.
- V317 tests: 10/10 passed.
- V318 tests: 20/20 passed.
- Sacred MD5 hashes for `fiatLedger.js` and `auditLog.js` preserved.
