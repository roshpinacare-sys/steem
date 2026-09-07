# NEXT_SESSION_PROMPT_V257.md — Start of V258 (Phase P154)

## State at V257
- Version 257.0.0. New: `cronParser257` (full 5-field cron), `automationScheduler257`
  (persistent state + full cron), `automationDashboard257.jsx` (React ops dashboard).
- Persistent scheduler: saves/restores state via `snapshotEngine.setExtra/getExtra`.
- Cron API: `POST /api/v1/admin/cron257/parse` and `.../next`.
- Scheduler257 API: start/stop/status at `/api/v1/admin/scheduler257/…`.
- Sacred intact. node --check clean. v257 (43) + v255 (18) + v254 (19) green.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v257.test.js
NODE_ENV=test node tests/v255.test.js
NODE_ENV=test node tests/v254.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- Sacred immutable; `lib/` mirrors `src/lib/`; suffix ids by version; R6 no new npm deps.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`.

## V258 — Wire Scheduler257 Auto-Start + snapshotEngine.setExtra + WebSocket HITL

### P154-A: Wire scheduler257 into ecos-api-server.js
Add a `_wireAutomationScheduler257()` IIFE at the end of `ecos-api-server.js` that:
- Requires `automationScheduler257` and `cronParser257`.
- Reuses the existing `_catalog255` and `_tool237` refs (already in scope from V255 IIFE).
- Calls `registerV257Endpoints(app, { catalog255, toolCatalog237, snapshotEngine, logger })`.
- Auto-starts the scheduler if `ECOS_SCHEDULER_AUTOSTART=true` env var is set.

### P154-B: Extend SnapshotEngine with setExtra/getExtra
Add `setExtra(key, value)` and `getExtra(key)` methods to `snapshotEngine.js` so
`automationScheduler257` persistence is backed by the real snapshot store.
Include the extras map in `export()` and restore it in `restore(snap)`.

### P154-C: HITL WebSocket push
When a run reaches `hitl_paused` status in `automationRunner255`, emit a
`hitl_paused` event over the existing `notificationWsHub` so the dashboard
receives live updates without polling.

## Packaging
`ecos_v258_canonical.zip`, root `ecos_v258_canonical/`.
