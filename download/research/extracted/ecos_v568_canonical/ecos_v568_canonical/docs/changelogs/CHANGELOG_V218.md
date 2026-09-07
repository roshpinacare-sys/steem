# CHANGELOG — V218 (Phase P105)
**Date:** 2026-05-31 | **Base:** V217-canonical

## New in V218

### ecos-api-server-v218-patch.js (new file)
5 endpoints added, 1 new in-memory store:

| Task | Endpoint | Description |
|------|----------|-------------|
| T01 | `POST /workspaces/:id/validators/:uid/score-snapshot` | Record validator score snapshot into `_scoreHistory218` |
| T02 | `GET /workspaces/:id/validators/:uid/score-trend` | Read score trend (ascending by timestamp, ?limit) |
| T03 | `GET /workspaces/:id/treasury/flow-summary` | Treasury inflow/outflow/net from `_eventLog181` |
| T04 | `POST /workspaces/:id/governance/tally` | Stateless governance vote tally with quorum check |
| T05 | `GET /workspaces/:id/members/:uid/activity-window` | Member activity events in configurable day window |
| Tz  | `GET /admin/summary-v218` | Admin summary for V218 stores |

### New Store
- `_scoreHistory218` — Map(key=`${workspaceId}:${uid}` → entry[]), max 8,000 total entries (ring eviction by oldest timestamp).

### Constants
- `SCORE_HISTORY_MAX_218 = 8000`
- `SCORE_TREND_DEFAULT_LIMIT_218 = 20`
- `SCORE_TREND_MAX_LIMIT_218 = 200`
- `GOVERNANCE_QUORUM_218 = 0.51`
- `ACTIVITY_WINDOW_DEFAULT_DAYS_218 = 7`
- `ACTIVITY_WINDOW_MAX_DAYS_218 = 90`

## Tests
- `tests/v218.test.js` — all assertions passing.

## Invariants
- R1: Sacred files untouched (fiatLedger.js, auditLog.js).
- R2: All identifiers suffixed with `218`.
- R3: Zero new npm dependencies.
- R4: Exports inside `NODE_ENV=test` block.
- R5: package.json bumped to 218.0.0.
- R6: No existing endpoints removed.
- R7: No duplicate stores.
