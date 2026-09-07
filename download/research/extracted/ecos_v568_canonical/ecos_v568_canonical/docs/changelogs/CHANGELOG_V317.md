# CHANGELOG_V317 — ECOS Canonical Version 317

**Version:** 317.0.0  
**Phase:** P205  
**Date:** 2026-06-02

## Overview

V317 introduces advanced comparative and fuzzy analysis features on top of the V316 layer. Key additions include audit cap entry diffing, page range intensity heatmaps, fuzzy token matching for overlap searches, and automated anomaly detection for normalised cumulative deltas.

## Changes

### Core Modules (`src/lib/marketMaker317.js` & `lib/marketMaker317.js`)

- **AuditCapTrail317**: Added `auditCapHistoryDiff317(cursorA, cursorB)` for comparing two cap entries.
- **PageRangeDiffBridge317**: Added `pagedDiffPageRangeHeatmap317(...)` which returns normalized intensities per page.
- **RankedOverlapBuffer317**: Added `multiSearchOverlapFuzzy317(tokens, n)` which supports substring matching.
- **NormDeltaPercentilesTracker317**: Added `trendNormDeltaAnomalies317(...)` which filters buckets labeled as `spike`.

### API Endpoints (Additive)

- `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v317/aggregate/db/hydrate/audit/cap/history/diff`
- `GET  /api/v1/market/alerts/suppress/config/v317/diff/audit/filter/paged/range/heatmap`
- `POST /api/v1/market/backtest/sessions/v317/snapshot/search/ranked/multi/overlap/fuzzy`
- `GET  /api/v1/contracts/receipts/v317/histogram/rolling/percentiles/trend/delta/cumulative/norm/anomalies`

### Infrastructure

- `package.json` updated to `317.0.0`.
- `test:v317` script added.
- `tests/v317.test.js` created with 10/10 passing tests.

## Verification

- `node --check` passed for all new modules and server.
- V315 tests: 44/44 passed.
- V316 tests: 12/12 passed.
- V317 tests: 10/10 passed.
- Sacred MD5 hashes for `fiatLedger.js` and `auditLog.js` preserved.
