# NEXT_SESSION_PROMPT_V261.md — Start of V262 (Phase P158)

## State at V261
- Version 261.0.0. New: `ecos-api-server-v261-patch.js` (WS live helpers + NDJSON export).
- `pushHitlLiveEvent261` / `subscribeHitlLive261`: broadcast HITL events to WS clients.
- `getWsStatus261`: probe WS hub capabilities.
- `exportHitlHistoryNdjson261`: NDJSON export with `since`/`until`/`type` ISO8601 filters.
- `clearHitlHistory261`: operator-only persistent history clear.
- `GET  /api/v1/automations/hitl-history/export`: NDJSON streaming endpoint [V261-T01].
- `DELETE /api/v1/automations/hitl-history`: operator-only clear [V261-T02].
- `GET  /api/v1/admin/ws261/status`: WS capability probe [V261-T03].
- `artifacts/automationDashboard260.jsx`: Dashboard V4 — WS live connection, NDJSON export button, WsLiveIndicator.
- Sacred intact. node --check clean. v261 (38) + v260 (32) + v259 (22) + v258 (17) + v257 (43) green.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v261.test.js
NODE_ENV=test node tests/v260.test.js
NODE_ENV=test node tests/v259.test.js
NODE_ENV=test node tests/v258.test.js
NODE_ENV=test node tests/v257.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- Sacred immutable; `lib/` mirrors `src/lib/`; suffix ids by version; R6 no new npm deps.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`.

## V262 Suggested Work (Phase P158)

### Option A: Wire pushHitlLiveEvent261 into the server event loop
`pushHitlLiveEvent261` and `subscribeHitlLive261` are defined but not yet called by
`rejectHitlRun260` or `automationRunner255`. Wire them:
1. In `rejectHitlRun260` (V260 patch), after appending the history event, call
   `pushHitlLiveEvent261(notificationWsHub, { type: 'hitl_rejected', ... })`.
2. In `automationRunner255.runAutomation255`, when a step transitions to `hitl_paused`,
   call `pushHitlLiveEvent261` with `{ type: 'hitl_paused', runId, toolName, step }`.
3. In the resume endpoint (V256), call `pushHitlLiveEvent261` with `type: 'hitl_resumed'`.
This closes the loop: the Dashboard V4 live feed becomes fully functional end-to-end.

### Option B: HITL History REST filters (since/until on the non-export endpoint)
`GET /api/v1/automations/hitl-history` currently only supports `type`, `runId`, `limit`.
Add `since` and `until` ISO8601 query params matching the V261 export endpoint contract.
Useful for dashboard incremental polling as WS fallback.

### Option C: Dashboard Operator Mode
Add an operator unlock flow to `automationDashboard260.jsx`:
- A lock/unlock toggle that reveals an "Operator" section.
- Operator section shows: clear history button (calls `DELETE /api/v1/automations/hitl-history`
  with `x-operator-token` header), raw NDJSON export with custom `since`/`until` date pickers,
  and live WS client count from `/api/v1/admin/ws261/status`.

## Packaging
`ecos_v262_canonical.zip`, root `ecos_v262_canonical/`.
