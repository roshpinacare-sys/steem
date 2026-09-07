# CHANGELOG — V217 (Phase P104)
**Date:** 2026-05-31 | **Base:** V216-canonical

## New in V217

### ecos-api-server-v217-patch.js (new file)
5 endpoints added, 1 new in-memory store:

| Task | Endpoint | Description |
|------|----------|-------------|
| T01 | `POST /workspaces/:id/validators/leaderboard-snapshot` | Create validator leaderboard snapshot (topN, sorted by rep) |
| T02 | `GET /workspaces/:id/validators/leaderboard-history` | List snapshots for workspace, sorted timestamp desc, ?limit |
| T03 | `GET /workspaces/:id/tasks/completion-rate` | Stateless task completion rate from _eventLog181 |
| T04 | `GET /workspaces/:id/members/:uid/decay-simulation` | Reputation decay projection (day 0–30, 0.5%/day) |
| T05 | `POST /workspaces/:id/members/sybil-batch` | Batch sybil check for up to 50 uids |
| Tz  | `GET /admin/summary-v217` | Admin summary for V217 stores |

### New Store
- `_leaderboardSnapshots217` — Map(workspaceId → snapshot[]), max 5,000 total, ring eviction by oldest timestamp.

### Constants
- `LEADERBOARD_SNAPSHOT_MAX_217 = 5000`
- `DECAY_RATE_PER_DAY_217 = 0.005`
- `SYBIL_BATCH_MAX_217 = 50`

## Tests
- `tests/v217.test.js` — 88 assertions, all passing.

## Invariants
- R1: Sacred files untouched (fiatLedger.js, auditLog.js).
- R2: All identifiers suffixed with `217`.
- R3: Zero new npm dependencies.
- R4: Exports inside `NODE_ENV=test` block.
- R5: package.json bumped to 217.0.0.
- R6: No existing endpoints removed.
- R7: No duplicate stores.
