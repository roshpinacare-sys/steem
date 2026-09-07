# NEXT_SESSION_PROMPT_V276.md — Start of V277

## State at V276
- Version 276.0.0. Healthy canonical: sacred intact, all real self-running unit suites green.
- V276 shipped: `alertResolution276.js` + `providerAdapters276.js` + API patch v276.
  The resolution module wraps CounterAlertBus275 history with lifecycle management:
  `resolveAlert276(alertId)` marks resolved + broadcasts over SSE.
  `acknowledgeAlert276(alertId)` marks acked + broadcasts.
  `getUnresolved276()` returns only active (unresolved) alerts.
  `wireManualOverride276()` hooks manualOverride273 so operators see overrides in SSE feed.
  Optional DB persistence to `credit_alert_history276` when `db` pool injected.
  SSE endpoint `/api/v276/alerts/resolution/subscribe` streams resolution events in real-time.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
NODE_ENV=test node tests/v274.test.cjs
NODE_ENV=test node tests/v275.test.cjs
NODE_ENV=test node tests/v276.test.cjs
```

## Iron rules (unchanged)
- Sacred files immutable (verify md5 before+after). `lib/` mirrors `src/lib/`.
- Suffix new identifiers by version. R6: no new npm deps.
- Relax any hardcoded `version === 'N.0.0'` to `major >= N`.
- Old suites assert per-version docs exist — create the stub if needed.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`. Verify from re-extract.

## Suggested V277 direction
With resolution + acknowledgement live and manual overrides visible in the SSE feed,
the next natural move is **alert escalation + operator assignment**:

1. Add `escalateAlert277(alertId, opts)` — marks an alert as escalated to a named
   operator/team. Escalated alerts get a higher-priority visual flag in the SSE stream.
2. Add `assignAlert277(alertId, assignee)` — assign an alert to a specific operator.
   Stores assignment metadata; broadcasts ALERT_ASSIGNED event over SSE.
3. Add `GET /api/v277/alerts/assigned/:assignee` — alerts assigned to a given operator.
4. Add `GET /api/v277/alerts/escalated` — all escalated unresolved alerts.
5. Optionally: persist assignments to `credit_alert_assignments277` DB table.

Keep it chat-first, mobile-light, community-positive. No tradable personal token yet.

## Packaging
`ecos_v277_canonical.zip`, root `ecos_v277_canonical/`.
