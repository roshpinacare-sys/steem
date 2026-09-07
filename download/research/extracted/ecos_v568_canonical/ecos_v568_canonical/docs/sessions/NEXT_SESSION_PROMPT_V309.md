# NEXT_SESSION_PROMPT_V309.md — Start of V310

## State at V309
- Version `309.0.0`, Phase **P197**.
- New: `marketMaker309` (lib + src/lib mirror) =
  `PersistedAggregateHistory309` (persistAggregate309(pool); upserts to `ecos_prune_aggregate`; aggregatePersistStats309()) +
  `AutoDiffBridge309` (autoDiff309 flag; _diffAudit309 ring; getDiffAudit309()) +
  `RankedSnapshotBuffer309` (rankedSearch309(token); sorted by eventCount desc) +
  `TrendPercentilesTracker309` (percentileTrend309(source,windowMs,buckets); p50/p95/p99 per sub-window).
- Endpoints (all additive):
  `GET  /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v309/aggregate/db`,
  `GET  /api/v1/market/alerts/suppress/config/v309/diff/audit`,
  `GET  /api/v1/market/backtest/sessions/v309/snapshot/search/ranked?token=`,
  `GET  /api/v1/contracts/receipts/v309/histogram/rolling/percentiles/trend?source=&windowMs=&buckets=`.
  All V287..V308 routes preserved.
- Tests: v307 36/36, v308 29/29, v309 32/32.
- Sacred MD5 unchanged:
  `lib/fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5`,
  `lib/auditLog.js`  `e5a5c2c27801d2d03991bc8e5a1df8cb`.

## ⚠️ Pre-flight (do FIRST in V310)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v308.test.js
NODE_ENV=test node tests/v309.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f… / e5a5c2c2…
```
- R1 sacred immutable · `lib/` mirrors `src/lib/` · suffix ids with `310`
- R3 / R6 no new npm deps · R6 preserve all existing endpoints
- Ship ONE `ecos_v310_canonical.zip`, root `ecos_v310_canonical/`

## High-leverage V310 directions

1. **Aggregate history load-back** — `PersistedAggregateHistory309` can persist but
   not restore. Add `loadAggregate310(pool)` that reads the singleton row back from
   `ecos_prune_aggregate` and returns it as a plain object.
   Expose `GET /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v310/aggregate/db/load`.

2. **Diff audit filtering** — `AutoDiffBridge309.getDiffAudit309()` returns all entries.
   Add `filterDiffAudit310(fromVersion, toVersion)` that filters the audit ring to only
   entries whose `fromVersion` / `toVersion` fall within the given range.
   Expose `GET /api/v1/market/alerts/suppress/config/v310/diff/audit/filter?from=&to=`.

3. **Multi-token ranked search** — `RankedSnapshotBuffer309.rankedSearch309` handles
   one token at a time. Add `multiRankedSearch310(tokens[])` that accepts an array of
   tokens and returns a merged, globally-ranked list of all occurrences.
   Expose `POST /api/v1/market/backtest/sessions/v310/snapshot/search/ranked/multi`
   (body `{ tokens: [...] }`).

4. **Trend summary** — `TrendPercentilesTracker309.percentileTrend309` returns per-bucket
   data. Add `trendSummary310(source, windowMs, buckets)` that computes the trend and
   also returns global p50/p95/p99 across all buckets plus peak-bucket indices (the
   bucket with the highest p99).
   Expose `GET /api/v1/contracts/receipts/v310/histogram/rolling/percentiles/trend/summary?source=&windowMs=&buckets=`.

## Packaging
`ecos_v310_canonical.zip`, root `ecos_v310_canonical/`.
