# NEXT_SESSION_PROMPT_V256.md — Start of V257 (Phase P153)

## State at V256
- Version 256.0.0. New: `automationScheduler256` — cron-like scheduler for `schedule` automations.
- HITL resume: `POST /api/v1/automations/:runId/resume` — resumes paused runs from `pausedAtStep`.
- Scheduler: start/stop/status endpoints + `listScheduled256()` with nextRunAt tracking.
- Run history: `GET /api/v1/automations/:id/runs` with limit/offset pagination.
- Sacred intact. node --check clean. v256 + v255 + v254 green.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v256.test.js
NODE_ENV=test node tests/v255.test.js
NODE_ENV=test node tests/v254.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- Sacred immutable; `lib/` mirrors `src/lib/`; suffix ids by version; R6 no new npm deps.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`.

## V257 — Automation Dashboard + Persistent Scheduler State

### P153-A: Automation Run Dashboard
A React artifact (`automationDashboard257.jsx`) showing:
- List of all automations with last-run status and run count.
- Live scheduler status (running/stopped, entries, nextRunAt).
- HITL queue — paused runs awaiting approval, with a "Resume" button.
- Run history per automation.

### P153-B: Persistent Scheduler State
On server restart, reload scheduler configuration from a persisted snapshot
(via `snapshotEngine`) so scheduled automations survive reboots without
requiring a manual `POST /api/v1/admin/scheduler/start`.

### P153-C: Full Cron Expression Support
Extend `_parseIntervalMs256` → `parseCronExpression257` to handle standard
5-field cron expressions (`minute hour day month weekday`) via a lightweight
in-process evaluator (no npm deps — pure Node.js).

## Packaging
`ecos_v257_canonical.zip`, root `ecos_v257_canonical/`.
