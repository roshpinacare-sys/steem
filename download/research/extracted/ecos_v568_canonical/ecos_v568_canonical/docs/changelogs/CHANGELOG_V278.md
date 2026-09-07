# ECOS V278 Changelog

**Release date:** 2026-06-01
**Branch:** canonical
**Baseline:** V277 (all V277 tests passing)

---

## Summary

V278 is a purely **additive** release. No V277 module signatures, exports, or
behaviour are changed. All V277 tests continue to pass unchanged.

---

## New: `alertSla278.js` (src/lib + lib mirror)

Alert SLA timer management and breach detection — built on top of the V277 escalation lifecycle.

### registerAlertSla278(alertType, opts)

Registers an SLA definition for a named alert type. Accepts:
- `warningMs` — milliseconds after alert creation to fire `SLA_WARNING` (default 300,000 = 5 min)
- `breachMs`  — milliseconds after alert creation to fire `SLA_BREACH`  (default 900,000 = 15 min)
- `autoEscalate` — when `true`, automatically escalates to CRITICAL on breach via AlertEscalation277

Returns `{ ok, alertType, warningMs, breachMs, autoEscalate }`. Broadcasts `SLA_REGISTERED`
event over the SSE stream and stores config in the in-memory config map.

Validation: `warningMs` must be less than `breachMs`.

### checkSlaBreach278(alertId)

On-demand SLA status for a single alert. Looks up the alert in CounterAlertBus275 history
and computes age against the registered SLA config for its type.

Returns `{ ok, alertId, status, ageMs, warningMs, breachMs, warningFiredAt?, breachFiredAt?, createdAt }`.

Status values:
- `OK`       — alert age is below `warningMs`
- `WARNING`  — alert age is between `warningMs` and `breachMs`
- `BREACHED` — alert age has exceeded `breachMs`
- `RESOLVED` — alert is already resolved

### runSlaCheck278()

Scans all active (unresolved) alerts in CounterAlertBus275 history and checks them against
registered SLA configs. Fires `SLA_WARNING` and `SLA_BREACH` events exactly once per alert
per threshold (idempotent — will not re-fire if already fired). When `autoEscalate: true` is
set and `breachMs` is exceeded, calls `escalateAlert277(alertId, { priority: 'CRITICAL', ... })`
on the AlertEscalation277 instance.

Returns `{ ok, checked, warnings, breaches }`.

### getBreachedAlerts278(opts?)

Returns all currently breached (age ≥ breachMs), unresolved alerts.
Supports optional `alertType` filter. Returns `{ ok, alerts, total }`.

### getWarningAlerts278()

Returns alerts whose age falls between `warningMs` and `breachMs` (warning zone).
Returns `{ ok, alerts, total }`.

### getSlaStatus278()

Full SLA dashboard: config list, per-type breach counts, per-type warning counts,
total active alert count, and live SLA record count.
Returns `{ ok, version, configs, breachCounts, warnCounts, totalAlerts, configCount, slaRecords }`.

### getSlaConfig278(alertType) / deregisterAlertSla278(alertType)

Retrieve or remove an SLA config for an alert type.

### Watchdog

`startSlaWatchdog278(intervalMs?)` — starts a background `setInterval` (default 5 s) that
calls `runSlaCheck278()` automatically. Safe to call multiple times (second call returns
`alreadyRunning: true`). `stopSlaWatchdog278()` clears the timer.

### SSE SLA event stream

`addSlaSseClient278(res)` registers an Express response as an SLA SSE client (max 200).
On connect, the last 10 events are sent as `event: history`. Subsequent SLA events arrive
as `event: sla`. Heartbeat every 30 s.

### DB persistence (optional)

When a `db` pool is injected, SLA events (`SLA_WARNING`, `SLA_BREACH`) are persisted to
`credit_alert_sla_events278`. Schema DDL exported as `CREDIT_ALERT_SLA_EVENTS_TABLE_278`.
Best-effort — never throws.

### Telemetry

- `checkAlertSlaHealth278()` — `{ ok, version, configCount, slaRecords, sseClients, eventHistory, watchdogActive }`
- `getStatus278()` — same as checkAlertSlaHealth278()
- `getEventHistory278(opts)` — SLA event log (capped at 500)

---

## New: `providerAdapters278.js` (src/lib + lib mirror)

Extends providerAdapters277 with one new DI contract:

| Contract key | Required methods |
|---|---|
| `alertSla` | `registerAlertSla278`, `checkSlaBreach278`, `getBreachedAlerts278`, `getSlaStatus278`, `addSlaSseClient278`, `removeSlaSseClient278`, `getStatus278` |

Total contracts: **28** (27 from V277 + 1 new).

`createAlertSlaStub278()` and `createAllStubs278()` provide test-safe factory functions.

---

## New: `ecos-api-server-v278-patch.js`

### New V278 endpoints

| Method | Path | Description |
|---|---|---|
| GET    | `/api/v278/health`                          | Health + SLA status |
| GET    | `/api/v278/perf`                            | Aggregate perf telemetry |
| POST   | `/api/v278/providers/validate`              | 28-contract validation |
| POST   | `/api/v278/alerts/sla/register`             | **Register SLA for alert type** |
| DELETE | `/api/v278/alerts/sla/:alertType`           | **Deregister SLA config** |
| GET    | `/api/v278/alerts/sla/config/:alertType`    | **Get SLA config for alert type** |
| GET    | `/api/v278/alerts/:alertId/sla`             | **On-demand SLA check for alert** |
| GET    | `/api/v278/alerts/sla/breached`             | **All breached unresolved alerts** |
| GET    | `/api/v278/alerts/sla/warning`              | **Alerts in WARNING state** |
| GET    | `/api/v278/alerts/sla/status`               | **SLA config + live breach counts** |
| POST   | `/api/v278/alerts/sla/check`                | **On-demand SLA check (all alerts)** |
| POST   | `/api/v278/alerts/sla/watchdog/start`       | **Start SLA watchdog** |
| POST   | `/api/v278/alerts/sla/watchdog/stop`        | **Stop SLA watchdog** |
| GET    | `/api/v278/alerts/sla/subscribe`            | **SSE SLA event stream** |
| GET    | `/api/v278/alerts/sla/history`              | SLA event history |
| GET    | `/api/v278/alerts/sla/schema`               | DB schema DDL |

### All V277 routes preserved (backward compatible)

---

## New: Test Suite — `tests/v278.test.cjs`

Self-running suite covering:

- A. Version stamps (package.json, .agent-identity.json)
- B. New module files + lib mirrors
- C. registerAlertSla278 — validation, defaults, error cases
- D. checkSlaBreach278 — status detection (OK / WARNING / BREACHED / RESOLVED)
- E. getBreachedAlerts278 / getWarningAlerts278 — filtering
- F. getSlaStatus278 — config + breach counts
- G. runSlaCheck278 — event firing, auto-escalate wiring
- H. Watchdog start / stop
- I. SSE client management (add, remove, broadcast, heartbeat, shutdown)
- J. Event history + getStatus278 + health check
- K. providerAdapters278 (28 contracts, stub validation, pass/fail)
- L. API patch (createV278State, route registration, V277 backward compat)
- M. Release documentation
- N. Sacred file integrity (MD5 verified)

---

## Dependencies

Zero new npm dependencies. All V278 code uses Node.js built-ins only.

---

## Identifier Convention

All new exports, constants, methods, and class names end with the suffix `278`.
No V277 identifier is removed or renamed.
