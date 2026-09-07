# NEXT_SESSION_PROMPT_V278.md — Start of V279

## State at V278
- Version 278.0.0. Healthy canonical: sacred intact, all real self-running unit suites green.
- V278 shipped: `alertSla278.js` + `providerAdapters278.js` + API patch v278.
  The SLA module builds on AlertEscalation277 with full timer lifecycle:
  `registerAlertSla278(alertType, opts)` defines SLA thresholds per alert type (warningMs, breachMs, autoEscalate).
  `checkSlaBreach278(alertId)` returns on-demand SLA status (OK / WARNING / BREACHED / RESOLVED).
  `getBreachedAlerts278(opts)` returns all breached unresolved alerts (filterable by alertType).
  `getWarningAlerts278()` returns alerts in the WARNING zone.
  `getSlaStatus278()` returns full SLA dashboard with per-type breach/warning counts.
  `runSlaCheck278()` scans all active alerts and fires SLA events idempotently.
  `startSlaWatchdog278(intervalMs)` starts background periodic checking (default 5 s).
  Auto-escalate wires into AlertEscalation277 — CRITICAL escalation on breach when configured.
  SSE endpoint `/api/v278/alerts/sla/subscribe` streams SLA warning/breach events.
  Optional DB persistence to `credit_alert_sla_events278`.
  Provider contract 28: `alertSla`.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
NODE_ENV=test node tests/v275.test.cjs
NODE_ENV=test node tests/v276.test.cjs
NODE_ENV=test node tests/v277.test.cjs
NODE_ENV=test node tests/v278.test.cjs
```

## Iron rules (unchanged)
- Sacred files immutable (verify md5 before+after). `lib/` mirrors `src/lib/`.
- Suffix new identifiers by version. R6: no new npm deps.
- Relax any hardcoded `version === 'N.0.0'` to `major >= N`.
- Old suites assert per-version docs exist — create the stub if needed.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`. Verify from re-extract.

## Suggested V279 direction
With SLA timers, breach detection, and auto-escalation now live, the next natural move is
**alert aggregation + digest reporting**:

1. Add `aggregateAlerts279(opts)` — group active alerts by type, severity, and assignee;
   return counts, top breached types, and escalation summary.
2. Add `generateAlertDigest279(opts)` — produce a human-readable digest object
   suitable for email/Slack delivery: { period, totalAlerts, breached, warned, escalated, topTypes }.
3. Add `GET /api/v279/alerts/digest` — on-demand digest.
4. Add `GET /api/v279/alerts/aggregate` — grouped aggregate view.
5. Optionally: scheduled digest via a simple cron-like interval (R6: no new deps,
   use setInterval) with `startDigestScheduler279(intervalMs)`.

Keep it chat-first, mobile-light, community-positive. No tradable personal token yet.

## Packaging
`ecos_v279_canonical.zip`, root `ecos_v279_canonical/`.
