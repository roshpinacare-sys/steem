# NEXT_SESSION_PROMPT_V260.md — Start of V261 (Phase P157)

## State at V260
- Version 260.0.0. New: `ecos-api-server-v260-patch.js` (HITL persistence via snapshotEngine.setExtra).
- `appendHitlEvent260` / `getHitlHistory260`: persisted HITL event log (ring-buffer 5,000 entries).
- `rejectHitlRun260`: persistent version of V259 reject — stores to snapshotEngine.setExtra.
- `GET /api/v1/automations/hitl-history`: unified HITL event history endpoint (type/runId/limit filters).
- `POST /api/v1/automations/:runId/reject260`: persistent reject, returns `persisted: true/false`.
- `automationDashboard259.jsx`: Dashboard V3 with HitlHistoryPanel (type filter, newest-first).
- Sacred intact. node --check clean. v260 (32) + v259 (22) + v258 (17) + v257 (43) green.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v260.test.js
NODE_ENV=test node tests/v259.test.js
NODE_ENV=test node tests/v258.test.js
NODE_ENV=test node tests/v257.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- Sacred immutable; `lib/` mirrors `src/lib/`; suffix ids by version; R6 no new npm deps.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`.

## V261 Suggested Work (Phase P157)

### Option A: WebSocket Live Dashboard — real-time HITL events
`automationDashboard259.jsx` still polls. Wire a WebSocket subscription to
`notificationWsHub` events (`hitl_paused`, `hitl_rejected`) so the dashboard
updates instantly without polling. Add `useEffect` that opens a WS connection
and dispatches received events into the local HITL queue + history state.

### Option B: Automation Dry-Run mode
Add `?dryRun=true` to `POST /api/v1/automations/:id/run` so the runner executes
all HITL classification and verification steps but skips actual tool execution.
Returns a preview of which steps would be blocked/paused/allowed and estimated cost.
Useful for testing automation recipes before enabling them in production.

### Option C: HITL History Export
Add `GET /api/v1/automations/hitl-history/export` that returns the full persisted
history as NDJSON (one event per line) for offline analysis or audit compliance.
Add optional `since` / `until` ISO8601 timestamp params. Also add
`DELETE /api/v1/automations/hitl-history` (operator-only) to clear the persisted log.

## Packaging
`ecos_v261_canonical.zip`, root `ecos_v261_canonical/`.
