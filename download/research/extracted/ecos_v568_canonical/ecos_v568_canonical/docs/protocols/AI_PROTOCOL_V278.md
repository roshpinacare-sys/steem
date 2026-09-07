# ECOS AI Protocol — V278

**Version:** 278
**Date:** 2026-06-01
**Status:** Canonical

---

## 1. Overview

V278 extends the ECOS AI protocol with alert SLA timer management and breach detection:

**Alert SLA timers** — operators register SLA thresholds (warningMs, breachMs) per alert type.
The system tracks alert age against registered SLAs, fires `SLA_WARNING` / `SLA_BREACH` events,
broadcasts over SSE, and can auto-escalate to CRITICAL priority via AlertEscalation277.

---

## 2. AlertSla278 Protocol

### 2.1 registerAlertSla278(alertType, opts)

```js
alertSla.registerAlertSla278('SYBIL_FAIL_RATE', {
  warningMs:    300_000,  // 5 min → SLA_WARNING
  breachMs:     900_000,  // 15 min → SLA_BREACH
  autoEscalate: true,     // escalate to CRITICAL on breach
});
// → { ok, alertType, warningMs, breachMs, autoEscalate }
```

Stores SLA config in memory; broadcasts `SLA_REGISTERED` over SSE.
`warningMs` must be less than `breachMs`.

### 2.2 checkSlaBreach278(alertId)

```js
alertSla.checkSlaBreach278('alert-uuid');
// → { ok, alertId, status: 'OK'|'WARNING'|'BREACHED'|'RESOLVED', ageMs,
//     warningMs, breachMs, warningFiredAt?, breachFiredAt?, createdAt }
```

On-demand SLA status. Looks up the alert in CounterAlertBus275 history,
computes age, returns status relative to the registered SLA thresholds.

### 2.3 getBreachedAlerts278(opts?)

```js
alertSla.getBreachedAlerts278({ alertType: 'SYBIL_FAIL_RATE' });
// → { ok, alerts: [...], total }
```

Filters CounterAlertBus275 history for alerts where age ≥ breachMs.
Supports optional `alertType` filter. Excludes resolved alerts.

### 2.4 getSlaStatus278()

```js
alertSla.getSlaStatus278();
// → { ok, version, configs, breachCounts, warnCounts, totalAlerts, configCount, slaRecords }
```

Full SLA dashboard: config list + live per-type breach/warning counts.

### 2.5 runSlaCheck278()

```js
alertSla.runSlaCheck278();
// → { ok, checked, warnings, breaches }
```

Scans all active alerts. Fires `SLA_WARNING` / `SLA_BREACH` once per alert per threshold
(idempotent). Auto-escalates to CRITICAL when `autoEscalate: true` and breachMs exceeded.

### 2.6 Watchdog

```js
alertSla.startSlaWatchdog278(5_000);  // poll every 5 s (default)
alertSla.stopSlaWatchdog278();
```

Background timer that calls `runSlaCheck278()` at the configured interval.
Reports `watchdogActive` in health check.

### 2.7 SSE SLA event stream

```
event: history   (on connect — last 10 SLA events)
data: { "events": [...], "count": N }

event: sla       (on each SLA warning/breach/registration)
data: { "eventType": "SLA_WARNING|SLA_BREACH|SLA_REGISTERED",
        "data": {...}, "ecosVersion": "278", "ts": "..." }

: heartbeat      (every 30 s)
```

### 2.8 DB persistence (optional)

```sql
CREATE TABLE IF NOT EXISTS credit_alert_sla_events278 (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  alert_id     TEXT NOT NULL,
  alert_type   TEXT,
  age_ms       BIGINT,
  warning_ms   BIGINT,
  breach_ms    BIGINT,
  auto_escalate BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

When `db` pool injected, SLA events are upserted. Best-effort, never throws.

---

## 3. New Provider Contract

```
PROVIDER_CONTRACTS_278['alertSla'] = {
  required: ['registerAlertSla278', 'checkSlaBreach278', 'getBreachedAlerts278',
             'getSlaStatus278', 'addSlaSseClient278', 'removeSlaSseClient278', 'getStatus278'],
  optional: ['getSlaConfig278', 'deregisterAlertSla278', 'getWarningAlerts278',
             'runSlaCheck278', 'startSlaWatchdog278', 'stopSlaWatchdog278',
             'startSlaHeartbeat278', 'checkAlertSlaHealth278', 'getEventHistory278', 'shutdown278'],
}
```

Total DI contracts: **28** (27 from V277 + 1 new).

---

## 4. V278 API Endpoints

| Method | Path | Description |
|---|---|---|
| GET    | `/api/v278/health`                          | Health + SLA status |
| GET    | `/api/v278/perf`                            | Aggregate perf |
| POST   | `/api/v278/providers/validate`              | 28-contract validation |
| POST   | `/api/v278/alerts/sla/register`             | Register SLA for alert type |
| DELETE | `/api/v278/alerts/sla/:alertType`           | Deregister SLA config |
| GET    | `/api/v278/alerts/sla/config/:alertType`    | Get SLA config |
| GET    | `/api/v278/alerts/:alertId/sla`             | On-demand SLA check |
| GET    | `/api/v278/alerts/sla/breached`             | All breached unresolved alerts |
| GET    | `/api/v278/alerts/sla/warning`              | Alerts in WARNING state |
| GET    | `/api/v278/alerts/sla/status`               | SLA config + breach counts |
| POST   | `/api/v278/alerts/sla/check`                | On-demand SLA check (all) |
| POST   | `/api/v278/alerts/sla/watchdog/start`       | Start SLA watchdog |
| POST   | `/api/v278/alerts/sla/watchdog/stop`        | Stop SLA watchdog |
| GET    | `/api/v278/alerts/sla/subscribe`            | SSE SLA event stream |
| GET    | `/api/v278/alerts/sla/history`              | SLA event history |
| GET    | `/api/v278/alerts/sla/schema`               | DB schema DDL |

---

## 5. Versioning Rules

- All new identifiers in V278 end with the suffix `278`.
- No V277 identifier is removed, renamed, or made breaking.
- V278 modules are drop-in additions alongside V277 modules.
- Future versions (V279+) MUST follow the same additive-only, suffix-versioned pattern.

---

## 6. Security Constraints (inherited + new)

| Constraint | Enforcement |
|---|---|
| SLA event idempotency | Warning/breach fires exactly once per alert per threshold |
| Watchdog non-blocking | setInterval unref'd so it never blocks process exit |
| SSE capacity | Max 200 concurrent SLA SSE clients |
| DB best-effort | DB persistence never blocks or throws |
| Alert cooldown (inherited) | Min 10 s between same-type alerts (from CounterAlertBus275) |
| No self-attestation (inherited) | From reputationLedger268 |
| Sacred file guard (inherited) | injectionFirewall268 blocks writes to SACRED_FILES_268 |
| BigInt-only credits (inherited) | All μ¢ values use BigInt |
