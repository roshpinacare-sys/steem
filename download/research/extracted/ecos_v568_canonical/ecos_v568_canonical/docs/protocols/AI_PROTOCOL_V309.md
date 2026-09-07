# ECOS AI Protocol — V309

**Version:** 309
**Date:** 2026-06-02
**Phase:** P197
**Status:** Canonical

---

## 1. Overview

V309 follows the four directions called out in `NEXT_SESSION_PROMPT_V308.md`,
each purely additive on top of the V308 observability layer. Nothing existing
changes; every new symbol ends in `309`.

1. **PersistedAggregateHistory309** — extends `AggregateHistory308` with
   `persistAggregate309(pool)` that upserts the current aggregate snapshot to
   `ecos_prune_aggregate` DB table (single-row, fixed key `'singleton'`).
   Non-fatal if DB unavailable.

2. **AutoDiffBridge309** — extends `ConfigDiffBridge308` with `autoDiff309` flag:
   when true, auto-diffs previous→current config version on each persist and
   stores result in bounded ring `_diffAudit309`. Exposed via `getDiffAudit309()`.

3. **RankedSnapshotBuffer309** — extends `SearchableSnapshotBuffer308` with
   `rankedSearch309(token)` that returns occurrences sorted by `eventCount`
   descending so the most-active snapshots appear first.

4. **TrendPercentilesTracker309** — extends `PercentilesHistogramTracker308` with
   `percentileTrend309(source, windowMs, buckets)` that splits the window into
   equal sub-windows and returns p50/p95/p99 for each bucket.

---

## 2. HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v309/aggregate/db` | Persist & return aggregate snapshot |
| GET  | `/api/v1/market/alerts/suppress/config/v309/diff/audit` | Return diff audit ring entries |
| GET  | `/api/v1/market/backtest/sessions/v309/snapshot/search/ranked?token=` | Ranked snapshot search by eventCount |
| GET  | `/api/v1/contracts/receipts/v309/histogram/rolling/percentiles/trend?source=&windowMs=&buckets=` | Per-bucket p50/p95/p99 trend |

All V287..V308 routes are preserved unchanged.

---

## 3. Iron-rule compliance

- **R1 — Sacred files untouched.** `lib/fiatLedger.js`
  `563e9b1f9e67091a5b6527c0a92568e5` / `lib/auditLog.js`
  `e5a5c2c27801d2d03991bc8e5a1df8cb` md5 unchanged.
- **R2 — Version-suffixed identifiers.** All new symbols end in `309`.
- **R3 — No new npm deps.** Zero new dependencies.
- **R4 — Test env guard.** `tests/v309.test.js` runs only under `NODE_ENV === 'test'`.
- **R5 — `package.json` bumped** to `309.0.0`.
- **R6 — No endpoints removed.** All V287..V308 routes preserved.
- **R7 — No duplicate stores.** Extends V308 classes without adding new global stores.

---

## 4. Tests

`tests/v309.test.js` — 32/32 passing under `NODE_ENV=test`
(persisted aggregate ×8, auto diff ×8, ranked search ×7, percentile trend ×7, exports ×2).
