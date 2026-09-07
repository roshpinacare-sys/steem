# CHANGELOG_V321 — ECOS Canonical Version 321

**Version:** 321.0.0  
**Phase:** P209  
**Date:** 2026-06-02

## Overview

V321 extends V320 with four new analytical features: rolling forecast accuracy (MAE),
compound outlier severity trend detection across two time windows, connected-component
semantic cluster discovery via Union-Find on the Jaccard matrix, and stateful regime
duration tracking with change-event signalling.

## Changes

### Core Modules (`src/lib/marketMaker321.js` & `lib/marketMaker321.js`)

- **AuditCapTrail321**: Added `recordActual321(step, predicted, actual)` to register
  actual vs. predicted observations. Added `auditCapForecastMAE321(maxEntries)` to
  compute the rolling Mean Absolute Error over the last N recorded actuals.

- **PageRangeDiffBridge321**: Added `pagedDiffCompoundSeverityTrend321(...)` which calls
  `pagedDiffCompoundSeverity320` twice (primary + compare windows) and returns
  `severityDelta`, `trend` (`"increasing"` / `"decreasing"` / `"stable"`), and both
  full compound severity results.

- **RankedOverlapBuffer321**: Added `semanticClusterDiscovery321(tokens, threshold)` which
  uses `semanticSimilarityMatrix320` (V320) and `_UnionFind321` to find connected
  components of tokens where Jaccard ≥ threshold. Returns `clusters` sorted by size
  descending, plus `singletons` and `clusterCount`.

- **NormDeltaPercentilesTracker321**: Added `trendNormDeltaRegimeDuration321(...)` which
  wraps `trendNormDeltaRegimeClassifier320` with stateful duration tracking:
  `regimeDuration` increments on same regime and resets to 1 on change; `regimeChanged`
  is `true` on the first step after a transition. `resetRegimeDuration321()` clears state.

### Supporting Exports

- `_UnionFind321`: Union-Find with path compression (exported for testing).
- `SEVERITY_TREND_INCREASING_321`, `SEVERITY_TREND_DECREASING_321`, `SEVERITY_TREND_STABLE_321`.

### API Endpoints (Additive)

- `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v321/aggregate/db/hydrate/audit/cap/forecast/mae`
- `GET  /api/v1/market/alerts/suppress/config/v321/diff/audit/filter/paged/range/outliers/severity/trend`
- `POST /api/v1/market/backtest/sessions/v321/snapshot/search/ranked/semantic/clusters`
- `GET  /api/v1/contracts/receipts/v321/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/duration`

### Infrastructure

- `package.json` updated to `321.0.0`.
- `test:v321` script added.
- `tests/v321.test.js` created with 22/22 passing tests.

## Verification

- `node --check` passed for all new modules and server.
- V315 tests: 44/44 passed.
- V316 tests: 12/12 passed.
- V317 tests: 10/10 passed.
- V318 tests: 20/20 passed.
- V319 tests: 19/19 passed.
- V320 tests: 22/22 passed.
- V321 tests: 22/22 passed.
- Cumulative: 149/149 passed.
- Sacred MD5 hashes for `fiatLedger.js` and `auditLog.js` preserved.
