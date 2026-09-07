# CHANGELOG — V219 (Phase P106)
**Date:** 2026-05-31 | **Base:** V218-canonical

## New in V219

### ecos-api-server-v219-patch.js (new file)
5 endpoints added, **zero new in-memory stores** (all stateless reads of inherited stores):

| Task | Endpoint | Source Store | Description |
|------|----------|--------------|-------------|
| T01 | `GET /workspaces/:id/health-score` | `_eventLog181` | Weighted health score (activity 40%, task 40%, treasury 20%) |
| T02 | `GET /workspaces/:id/validators/:uid/performance-index` | `_scoreHistory218` + `_eventLog181` | Performance index: score avg + trend delta + activity 30d |
| T03 | `POST /workspaces/batch-summary` | `_eventLog181` | Batch summary for up to 20 workspaces |
| T04 | `GET /workspaces/:id/validators/:uid/score-percentile` | `_scoreHistory218` | Score percentile among workspace validators |
| T05 | `GET /workspaces/:id/events/replay` | `_eventLog181` | Event stream replay window (max 500, descending timestamp) |
| Tz  | `GET /admin/summary-v219` | — | Admin summary for V219 endpoints |

### Constants
- `BATCH_SUMMARY_MAX_219 = 20`
- `REPLAY_MAX_EVENTS_219 = 500`

## Tests
- `tests/v219.test.js` — 85/85 assertions passing.

## Invariants
- R1: Sacred files untouched (fiatLedger.js, auditLog.js).
- R2: All identifiers suffixed with `219`.
- R3: Zero new npm dependencies.
- R4: Exports inside `NODE_ENV=test` block.
- R5: package.json bumped to 219.0.0.
- R6: No existing endpoints removed.
- R7: No new stores (V219 is fully stateless).
