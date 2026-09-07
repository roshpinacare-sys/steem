# Changelog — V191 (Phase P80)

**Release:** ECOS V191 · 2026-05-30 · stabilized canonical build

## Pre-flight (clean bill of health)
- `node --check ecos-api-server.js` → passes (no duplicate-const, no shell corruption).
- Sacred files unchanged (R1): fiatLedger.js `563e9b1f9e67091a5b6527c0a92568e5` · auditLog.js `e5a5c2c27801d2d03991bc8e5a1df8cb`.
- V178–V190 suites still green; no prior endpoints removed (R4).

## Deliverable — Workspace Event Digest (`lib/workspaceEventDigestService191.js`)
Read-only aggregation over a workspace's event log: counts by type, top senders,
time range, and an hourly histogram. Pure + zero-dependency (R6); fully unit-testable.
Sources the **existing** `_eventLog181` ring buffer — no parallel store (per V190 chain notes).
Identifiers version-suffixed (`_eventDigest191`, `WorkspaceEventDigestService191`,
`DigestValidationError191`) to avoid the duplicate-const failure class (BUG-L).

- `GET /api/v1/workspaces/:workspaceId/events/digest?type=&topSenders=`  `[V191-T01]`
- `GET /api/v1/admin/summary/v191`                                       `[V191-T02]`

Events with no/invalid `sentAt` are counted in totals but excluded from the time
range and histogram; missing `type`/`senderId` bucket as `unknown`.

## Tests
`tests/v191.test.js` — 14 tests, all passing (type counts, sender ranking + tie-break,
time range, hourly buckets, type filter, limit clamp, unknown defaults, empty input,
validation, stats + server parse guard + wiring + version/docs/sacred checks).

## Breaking changes
None. Additive, read-only. All prior endpoints/tests preserved (R4, R5). No schema change.
