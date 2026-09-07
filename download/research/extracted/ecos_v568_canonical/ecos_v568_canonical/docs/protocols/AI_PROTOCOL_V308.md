# ECOS AI Protocol — V308

**Version:** 308
**Date:** 2026-06-02
**Phase:** P196
**Status:** Canonical

---

## 1. Overview

V308 follows the four directions called out in `NEXT_SESSION_PROMPT_V307.md`,
each purely additive on top of the V307 observability layer. Nothing existing
changes; every new symbol ends in `308`.

1. **AggregateHistory308** — extends `PersistentPruneHistory307` with
   `aggregateHistory308()` that computes summary statistics over the history ring:
   total rows pruned, average rows per run, success/error rate, first/last ran_at.

2. **ConfigDiffBridge308** — extends `VersionedAlertBridge307` with
   `diffConfigVersions308(vA, vB)` that compares the overrides at two version
   numbers and returns added/removed/changed adapter keys.

3. **SearchableSnapshotBuffer308** — extends `DiffSnapshotBuffer307` with
   `searchSnapshot308(token)` that scans all history entries and returns every
   index where the given session token appears (with its eventCount).

4. **PercentilesHistogramTracker308** — extends `RollingHistogramTracker307` with
   `rollingPercentiles308(source, windowMs)` that computes p50/p95/p99 from the
   timed observations within the window.

---

## 2. HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v308/aggregate` | Aggregate stats over prune history ring |
| POST | `/api/v1/market/alerts/suppress/config/v308/diff`                              | Diff overrides at two config versions; body `{ vA, vB }` |
| GET  | `/api/v1/market/backtest/sessions/v308/snapshot/search?token=`                 | Search all snapshots for a session token |
| GET  | `/api/v1/contracts/receipts/v308/histogram/rolling/percentiles?source=&windowMs=` | Rolling p50/p95/p99 for a source |

All V287..V307 routes are preserved unchanged.

---

## 3. Iron-rule compliance

- **R1 — Sacred files untouched.** `lib/fiatLedger.js`
  `563e9b1f9e67091a5b6527c0a92568e5` / `lib/auditLog.js`
  `e5a5c2c27801d2d03991bc8e5a1df8cb` md5 unchanged.
- **R2 — Version-suffixed identifiers.** All new symbols end in `308`.
- **R3 — No new npm deps.** Zero new dependencies.
- **R4 — Test env guard.** `tests/v308.test.js` runs only under `NODE_ENV === 'test'`.
- **R5 — `package.json` bumped** to `308.0.0`.
- **R6 — No endpoints removed.** All V287..V307 routes preserved.
- **R7 — No duplicate stores.** Extends V307 classes without adding new global stores.

---

## 4. Tests

`tests/v308.test.js` — 29/29 passing under `NODE_ENV=test`
(aggregate history ×8, config diff ×5, snapshot search ×6, percentiles ×7, exports ×3).
