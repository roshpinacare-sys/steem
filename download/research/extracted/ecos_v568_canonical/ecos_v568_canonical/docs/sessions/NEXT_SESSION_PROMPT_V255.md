# NEXT_SESSION_PROMPT_V255.md — Start of V256 (Phase P152)

## State at V255
- Version 255.0.0. New: `automationRunner255` — executes automation recipes step-by-step.
- Endpoints: `POST /api/v1/automations/:id/run` (ndjson stream), `POST /api/v1/automations/trigger-intake`, `GET /api/v1/admin/summary/v255`.
- V240 interlock enforced per step (block → abort, require_hitl → pause).
- Silent-failure detection via `assertNotSilentFailure240` per step.verify.
- Persistence via `appendMissionStep241` for crash recovery.
- Sacred intact. node --check clean. v255 + v254 + v253(58/0) green.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v255.test.js
NODE_ENV=test node tests/v254.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- Sacred immutable; `lib/` mirrors `src/lib/`; suffix ids by version; R6 no new npm deps.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`.

## V256 — HITL Resume + Automation Scheduler

### P152-A: HITL Resume
`POST /api/v1/automations/:runId/resume` — after human approval, resume a paused run
from the step where it was paused. Load saved steps from `resumeMission241`, pick up from
`pausedAtStep`, continue the remaining steps.

### P152-B: Automation Scheduler
Simple in-memory cron-like scheduler: read `schedule` automations from catalog, parse
a `cron` or `intervalMs` from `recipe.source` metadata, and call `triggerIntake255`
automatically. Store next-run timestamps. Max 100 scheduled automations.

### P152-C: Automation Run History
`GET /api/v1/automations/:id/runs` — list past run summaries for a given automation id,
sourced from `resumeMission241` store. Pagination support.

## Packaging
`ecos_v256_canonical.zip`, root `ecos_v256_canonical/`.
