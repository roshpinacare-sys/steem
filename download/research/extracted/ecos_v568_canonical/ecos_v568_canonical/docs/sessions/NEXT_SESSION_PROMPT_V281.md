# NEXT_SESSION_PROMPT_V281.md — Start of V282

## State at V281
- Version 281.0.0. Healthy canonical: sacred intact, all real self-running unit suites green.
- V281 shipped: `digestScheduler281.js` + `providerAdapters281.js` + API patch v281.
  The scheduler builds on NotificationChannel280 with full schedule registry + run history:
  `registerDigestSchedule281(name, opts)` registers a recurring digest+notify cycle.
  `deregisterDigestSchedule281(name)` removes a schedule and cancels its timer.
  `pauseSchedule281(name)` / `resumeSchedule281(name)` toggle without losing config.
  `getSchedules281()` lists all registered schedules.
  `getScheduleHistory281(opts)` returns run records (capped at 200).
  `addScheduleSseClient281(res)` / `removeScheduleSseClient281(clientId)` manage SSE.
  SSE events: `SCHEDULE_RUN_START`, `SCHEDULE_RUN_COMPLETE`, `SCHEDULE_RUN_FAILED`,
  `SCHEDULE_REGISTERED`, `SCHEDULE_REMOVED`, `SCHEDULE_PAUSED`, `SCHEDULE_RESUMED`.
  Provider contract 31: `digestScheduler`.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
NODE_ENV=test node tests/v277.test.cjs
NODE_ENV=test node tests/v278.test.cjs
NODE_ENV=test node tests/v279.test.cjs
NODE_ENV=test node tests/v280.test.cjs
NODE_ENV=test node tests/v281.test.cjs
```

## Iron rules (unchanged)
- Sacred files immutable (verify md5 before+after). `lib/` mirrors `src/lib/`.
- Suffix new identifiers by version. R6: no new npm deps.
- Relax any hardcoded `version === 'N.0.0'` to `major >= N`.
- Old suites assert per-version docs exist — create the stub if needed.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`. Verify from re-extract.

## Suggested V282 direction
With scheduled delivery live (register/pause/resume, run history, SSE), the next
natural move is **notification templates and conditional alert routing**:

1. Add `registerNotificationTemplate282(name, opts)` — named template with subject,
   body (Mustache-style `{{var}}`), and `contentType` (`'json'` | `'text'`).
2. Add `getTemplates282()` / `deregisterNotificationTemplate282(name)`.
3. Bind a template to a channel: `registerNotificationChannel282(name, { templateName, ... })`.
4. On `notifyDigest282(digest)` render the template before posting to webhook.
5. Add `GET /api/v282/alerts/templates` / `POST` / `DELETE /:name`.
6. Optional: `previewTemplate282(name, sampleDigest)` → rendered output.

Keep it chat-first, mobile-light, community-positive. No tradable personal token yet.

## Packaging
`ecos_v282_canonical.zip`, root `ecos_v282_canonical/`.
