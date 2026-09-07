# NEXT_SESSION_PROMPT_V262.md — Start of V263 (Phase P159)

## State at V262
- Version 262.0.0. New: `ecos-api-server-v262-patch.js` (WS wiring helpers + HITL REST since/until).
- `wrapRejectHitlRun262`: wraps `rejectHitlRun260` and fires `hitl_rejected` WS broadcast.
- `buildRunAutomation262Opts`: augments `runAutomation255` opts to broadcast `hitl_paused` / `hitl_resumed`.
- `getHitlHistory262`: REST history with `since` / `until` ISO8601 filters.
- `GET /api/v1/automations/hitl-history` now returns `ecosVersion: 'V262'` and `filters` object [V262-T01].
- `artifacts/automationDashboard261.jsx`: Dashboard V5 — Operator Mode (lock/unlock, WS client count, date-range NDJSON export, DELETE history).
- Sacred intact. node --check clean. v262 (48) + v261 (38) + v260 (32) + v259 (22) + v258 (17) + v257 (43) green.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v262.test.js
NODE_ENV=test node tests/v261.test.js
NODE_ENV=test node tests/v260.test.js
NODE_ENV=test node tests/v259.test.js
NODE_ENV=test node tests/v258.test.js
NODE_ENV=test node tests/v257.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- Sacred immutable; `lib/` mirrors `src/lib/`; suffix ids by version; R6 no new npm deps.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`.

## V263 Suggested Work (Phase P159)

### Option A: Wire V262 helpers into ecos-api-server.js
`wrapRejectHitlRun262` and `buildRunAutomation262Opts` are defined but not yet called by the
main server IIFE. Wire them:
1. In the V259/V260 IIFE that registers `registerV259Endpoints` / `registerV260Endpoints`,
   replace the `rejectHitlRun260` reference with `wrapRejectHitlRun262` so that each reject
   call fires a live WS broadcast.
2. In `registerV256Endpoints`'s resume handler, wrap the `runAutomation255` call:
   `const augOpts = buildRunAutomation262Opts(baseOpts, notificationWsHub);`
   `const result = await runAutomation255(augOpts);`
3. Add a new V262 wiring IIFE at the bottom of `ecos-api-server.js` that calls
   `registerV262Endpoints(app, { snapshotEngine, notificationWsHub, logger })`.
This makes Options A and B from V262 live in the running server.

### Option B: automationId filter on GET /api/v1/automations/hitl-history
The REST history endpoint currently supports `type`, `runId`, `limit`, `since`, `until`.
Add `automationId` as an additional filter param matching `event.automationId`.
Useful for per-automation drill-down in the dashboard.

### Option C: HITL History Streaming (NDJSON at scale)
`GET /api/v1/automations/hitl-history/export` currently loads the entire history into memory
before streaming. For very large logs (>10k events), add a true streaming path:
- Pipe events from `_loadHistory260` into the response incrementally using `res.write()`.
- Honour `since` / `until` / `type` filters without buffering the full filtered array first.
- Add `X-Stream-Mode: true` header to distinguish from the current batch-export mode.

## Packaging
`ecos_v263_canonical.zip`, root `ecos_v263_canonical/`.
