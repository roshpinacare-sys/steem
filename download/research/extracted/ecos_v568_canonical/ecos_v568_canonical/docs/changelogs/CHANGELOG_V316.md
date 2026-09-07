# CHANGELOG_V316 — ECOS Canonical Version 316

**Version:** 316.0.0  
**Phase:** P204  
**Date:** 2026-06-02

## Overview

V316 introduces advanced observability and explainability features on top of the V315 layer. Key additions include cursor-based pagination for audit cap history, aggregate range summary statistics, match explainability for token overlap searches, and threshold-based classification for normalised cumulative deltas.

## Changes

### Core Modules (`src/lib/marketMaker316.js` & `lib/marketMaker316.js`)

- **AuditCapTrail316**: Added `auditCapHistoryCursor316(cursor, limit)` for stateless pagination.
- **PageRangeDiffBridge316**: Added `pagedDiffPageRangeSummary316(...)` with aggregate stats (`nonEmptyPages`, `maxPageEntryCount`, etc.).
- **RankedOverlapBuffer316**: Added `multiSearchOverlapTopExplain316(tokens, n)` which attaches match ratio and matched token lists to results.
- **NormDeltaPercentilesTracker316**: Added `trendNormDeltaClassified316(...)` which labels buckets as `stable`, `elevated`, or `spike`.

### API Endpoints (Additive)

- `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v316/aggregate/db/hydrate/audit/cap/history/cursor`
- `GET  /api/v1/market/alerts/suppress/config/v316/diff/audit/filter/paged/range/summary`
- `POST /api/v1/market/backtest/sessions/v316/snapshot/search/ranked/multi/overlap/explain`
- `GET  /api/v1/contracts/receipts/v316/histogram/rolling/percentiles/trend/delta/cumulative/norm/classified`

### Infrastructure

- `package.json` updated to `316.0.0`.
- `test:v316` script added.
- `tests/v316.test.js` created with 12/12 passing tests.

## Verification

- `node --check` passed for all new modules and server.
- V314 tests: 42/42 passed.
- V315 tests: 44/44 passed.
- V316 tests: 12/12 passed.
- Sacred MD5 hashes for `fiatLedger.js` and `auditLog.js` preserved.
