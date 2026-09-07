# NEXT_SESSION_PROMPT_V259.md — Start of V260 (Phase P156)

## State at V259
- Version 259.0.0. New: `ecos-api-server-v259-patch.js` (HITL reject endpoint + hitl-queue listing).
- `rejectHitlRun259`: marks paused run as rejected, WS push, missionPersistence append.
- `listHitlQueue259`: lists all hitl_paused runs, excludes already-rejected.
- `automationDashboard258.jsx`: Dashboard V2 with HITL action panel (Resume + Reject).
- Sacred intact. node --check clean. v259 (22) + v258 (17) + v257 (43) green.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v259.test.js
NODE_ENV=test node tests/v258.test.js
NODE_ENV=test node tests/v257.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- Sacred immutable; `lib/` mirrors `src/lib/`; suffix ids by version; R6 no new npm deps.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`.

## V260 Suggested Work (Phase P156)

### Option A: HITL Persistence — rejectHitlRun259 currently stores to in-memory only
Add `_persistedRejects260` backed by `snapshotEngine.setExtra` so rejected runs
survive server restart. Add `GET /api/v1/automations/hitl-history` endpoint that
returns both paused + rejected + resumed runs across restarts.

### Option B: Automation Run Dashboard — run status polling
`automationDashboard258.jsx` shows HITL queue but has no run-status stream.
Add WebSocket subscription to `notificationWsHub` events in the React component
so `hitl_paused` and `hitl_rejected` events update the dashboard live without
full `fetchAll()` re-polling.

### Option C: Automation Dry-Run mode
Add `?dryRun=true` to `POST /api/v1/automations/:id/run` so the runner executes
all HITL classification and verification steps but skips actual tool execution.
Returns a preview of which steps would be blocked/paused/allowed.

## Packaging
`ecos_v260_canonical.zip`, root `ecos_v260_canonical/`.
