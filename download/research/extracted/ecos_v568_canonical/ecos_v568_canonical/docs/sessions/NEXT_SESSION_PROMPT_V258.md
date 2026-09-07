# NEXT_SESSION_PROMPT_V258.md — Start of V259 (Phase P155)

## State at V258
- Version 258.0.0. New: `_wireAutomationScheduler257()` IIFE wired in
  `ecos-api-server.js` with `ECOS_SCHEDULER_AUTOSTART` env-var auto-start.
- `SnapshotEngine` extended with `setExtra(key, val)` / `getExtra(key)` —
  extras included in `export()` body and restored in `restore(snap)`.
- `runAutomation255` accepts `notificationWsHub` opt; pushes `hitl_paused`
  event over WebSocket when a run is paused for HITL approval.
- Sacred intact. node --check clean.
- v258 (17) + v257 (43) + v255 (18) + v254 (19) green.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v258.test.js
NODE_ENV=test node tests/v257.test.js
NODE_ENV=test node tests/v255.test.js
NODE_ENV=test node tests/v254.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- Sacred immutable; `lib/` mirrors `src/lib/`; suffix ids by version; R6 no new npm deps.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`.

## V259 — Suggested next phase (P155): HITL Approval Endpoint + Dashboard V2

### P155-A: HITL Resume Endpoint
Add `POST /api/v1/automations/:runId/resume` that:
- Reads the paused run from `missionPersistence241`.
- Requires `{ approved: true, approvedBy: userId }` in body.
- Calls `resumeMission241(runId)` and re-enters `runAutomation255` from
  `pausedAtStep + 1`.
- Emits a `hitl_resumed` WS event via `notificationWsHub`.

### P155-B: HITL Rejection Endpoint
Add `POST /api/v1/automations/:runId/reject` that:
- Marks the run as `aborted` in `missionPersistence241`.
- Emits a `hitl_rejected` WS event.

### P155-C: automationDashboard258.jsx — HITL Action Panel
Extend the React dashboard with a HITL queue panel:
- Lists `hitl_paused` runs (polled or WS-driven).
- Approve / Reject buttons call the new endpoints.
- Shows real-time status updates via the existing WS connection.

## Packaging
`ecos_v259_canonical.zip`, root `ecos_v259_canonical/`.
