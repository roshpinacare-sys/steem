# Changelog — V256 (Phase P152) — HITL Resume + Automation Scheduler + Run History

**Release:** ECOS V256 · 2026-06-01 · AI lead

## Direction
V255 closed the loop on automation execution — recipes can be run step-by-step with the full
safety stack engaged. V256 completes the automation lifecycle:
- **HITL Resume** — paused runs can continue after human approval.
- **Automation Scheduler** — `schedule` automations trigger automatically via cron/interval.
- **Run History** — past run summaries are queryable per automation id.

## Feature — `automationScheduler256` (src/lib + lib mirror)

### createAutomationScheduler256(opts)
Simple in-memory cron-like scheduler:
- Reads all `schedule` automations from `automationCatalog254`.
- Parses a `cron` or `intervalMs` from each recipe's `source` metadata.
- Supported patterns: `intervalMs:NNN`, `@every NNN`, `*/N * * * *`, `0 */H * * *`.
- Calls `triggerIntake255` on each interval tick.
- Stores `nextRunAt`, `lastRunAt`, `runCount` per entry.
- Max 100 scheduled automations.

### API
| Method | Path | Tag | Description |
|--------|------|-----|-------------|
| `POST` | `/api/v1/automations/:runId/resume` | V256-T01 | Resume HITL-paused run; streams ndjson |
| `POST` | `/api/v1/admin/scheduler/start`     | V256-T02 | Start scheduler (loads catalog) |
| `POST` | `/api/v1/admin/scheduler/stop`      | V256-T03 | Stop all scheduled intervals |
| `GET`  | `/api/v1/admin/scheduler/status`    | V256-T04 | Scheduler status + entry list |
| `GET`  | `/api/v1/automations/:id/runs`      | V256-T05 | Paginated run history (`?limit=&offset=`) |
| `GET`  | `/api/v1/admin/summary/v256`        | V256-T06 | V256 summary |

## HITL Resume (P152-A)
`POST /api/v1/automations/:runId/resume` with `{ automationId, ctx? }`:
1. Load saved state via `resumeMission241(runId)`.
2. Find the `hitl_paused` step index.
3. Slice remaining steps from original recipe.
4. Register an ephemeral resume recipe and run via `runAutomation255`.
5. Stream ndjson progress of remaining steps.

## Verification
- `node --check` clean on all new files.
- `tests/v256.test.js` — 30 tests, all pass.
- V255 (`tests/v255.test.js`) and V254 (`tests/v254.test.js`) unchanged.
- Sacred files UNTOUCHED (R1): fiatLedger `563e9b1f…` · auditLog `e5a5c2c2…`.
- Zero new npm deps (R6).

## Breaking changes
None. Additive only.

## Next
- Gumloop populates catalog with real schedule-trigger automations.
- Persistent scheduler state (survive server restart via `snapshotEngine`).
- Advanced cron parsing (full 5-field expressions).
