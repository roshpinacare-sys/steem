# AI_PROTOCOL_V315 — ECOS Canonical Contract

**Version:** 315.0.0  
**Phase:** P203  
**Date:** 2026-06-02

## Purpose

V315 is an additive canonical layer over V314. It introduces pagination for cap-change history, per-page statistics for diff range retrieval, top-N limiting for ranked token overlap results, and aggregate statistics for normalised cumulative deltas. The release must preserve every V287..V314 route, module, and test-facing contract.

## Non-Negotiable Rules

| Rule | Requirement |
|---|---|
| R1 | `lib/fiatLedger.js`, `src/lib/fiatLedger.js`, `lib/auditLog.js`, and `src/lib/auditLog.js` are sacred and must not change. |
| R2 | Every new public identifier introduced by this release must end with `315`. |
| R3 | No new npm dependencies are allowed. |
| R4 | Test-only exports or test-only behaviour must remain guarded by the existing test patterns. |
| R5 | `package.json` must report `315.0.0`. |
| R6 | Existing endpoints and modules from earlier versions must not be removed or renamed. |
| R7 | Do not create a new store when an inherited V314/V313/V312 store already serves the same purpose. |

## V315 Module Contract

The canonical module is `src/lib/marketMaker315.js`, mirrored byte-for-byte into `lib/marketMaker315.js`. It must export `MM_VERSION_315`, four classes, four singleton helpers, `_coercePositiveInt315`, and `registerV315Endpoints(app)`.

| Export | Contract |
|---|---|
| `AuditCapTrail315` | Extends `AuditCapTrail314` and adds `auditCapHistoryPaged315(page, pageSize)`. |
| `defaultAuditCapTrail315` | Returns a singleton `AuditCapTrail315` unless options are provided. |
| `PageRangeDiffBridge315` | Extends `PageRangeDiffBridge314` and adds `pagedDiffPageRangeStats315(fromVersion, toVersion, startPage, endPage, pageSize)`. |
| `defaultPageRangeDiffBridge315` | Returns a singleton `PageRangeDiffBridge315` unless options are provided. |
| `RankedOverlapBuffer315` | Extends `RankedOverlapBuffer314` and adds `multiSearchOverlapTopN315(tokens, n)`. |
| `defaultRankedOverlapBuffer315` | Returns a singleton `RankedOverlapBuffer315` unless options are provided. |
| `NormDeltaPercentilesTracker315` | Extends `NormDeltaPercentilesTracker314` and adds `trendNormDeltaStats315(source, windowMs, buckets, baselineBucket)`. |
| `defaultNormDeltaPercentilesTracker315` | Returns a singleton `NormDeltaPercentilesTracker315` unless options are provided. |
| `registerV315Endpoints` | Adds exactly four V315 routes and does not mutate earlier route contracts. |

## API Contract

| Method | Path | Handler |
|---|---|---|
| GET | `/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v315/aggregate/db/hydrate/audit/cap/history/paged` | `auditCapHistoryPaged315(page, pageSize)` |
| GET | `/api/v1/market/alerts/suppress/config/v315/diff/audit/filter/paged/range/stats` | `pagedDiffPageRangeStats315(from, to, startPage, endPage, pageSize)` |
| POST | `/api/v1/market/backtest/sessions/v315/snapshot/search/ranked/multi/overlap/top` | `multiSearchOverlapTopN315(tokens, n)` |
| GET | `/api/v1/contracts/receipts/v315/histogram/rolling/percentiles/trend/delta/cumulative/norm/stats` | `trendNormDeltaStats315(source, windowMs, buckets, baseline)` |

## Behavioural Details

`auditCapHistoryPaged315` must paginate the inherited V314 cap-history ring without changing the underlying history. It returns a stable slice plus `totalCount`, `totalPages`, and `hasNextPage`, using page 1 and page size 20 as defaults.

`pagedDiffPageRangeStats315` must preserve the V314 range response shape while adding `perPage`. Each `perPage` element reports the effective page number and the number of entries returned by `pagedDiffWithMeta312` for that page. Inverted page ranges return an empty `entries` array and an empty `perPage` array.

`multiSearchOverlapTopN315` must call the V314 ranked overlap method and slice the already-ranked result. It must not re-rank or change entry shape. Invalid or missing `n` values resolve to 10; valid positive integers are used as-is.

`trendNormDeltaStats315` must call the V314 normalised trend method and compute stats over finite, non-null `normDelta` values only. If there are no finite values, `minNorm`, `maxNorm`, `meanNorm`, and `rangeNorm` must all be `null`.

## Verification Commands

```bash
node --check ecos-api-server.js
node --check src/lib/marketMaker315.js
node --check lib/marketMaker315.js
NODE_ENV=test node tests/v313.test.js
NODE_ENV=test node tests/v314.test.js
NODE_ENV=test node tests/v315.test.js
md5sum lib/fiatLedger.js lib/auditLog.js src/lib/fiatLedger.js src/lib/auditLog.js
```
