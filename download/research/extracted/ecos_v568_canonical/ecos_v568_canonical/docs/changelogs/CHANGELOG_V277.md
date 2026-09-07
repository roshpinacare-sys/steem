# ECOS V277 Changelog

**Release date:** 2026-06-01
**Branch:** canonical
**Baseline:** V276 (all V276 tests passing)

---

## Summary

V277 is a purely **additive** release. No V276 module signatures, exports, or
behaviour are changed. All V276 tests continue to pass unchanged.

---

## New: `alertEscalation277.js` (src/lib + lib mirror)

Alert escalation and operator assignment — built on top of the V276 resolution lifecycle.

### escalateAlert277(alertId, opts)

Marks an alert as escalated to a named operator or team. Escalated alerts receive
a higher-priority visual flag (`_priority277`) in the SSE stream. Supports two
priority levels: `'HIGH'` (default) and `'CRITICAL'`. Updates the CounterAlertBus275
history entry with `escalated: true`, `escalatedTo`, `escalatedBy`, and `priority277`.
Returns `{ ok, alertId, escalatedAt, priority, escalatedTo, alertFound }`.

### deescalateAlert277(alertId, opts)

Clears the escalation flag on an alert. Broadcasts `ALERT_DEESCALATED` event
over the SSE stream. Returns `{ ok, alertId, deescalatedAt }`.

### assignAlert277(alertId, assignee, opts)

Assigns an alert to a specific operator. Stores assignment metadata in an internal
map and maintains a reverse index (`assignee → Set<alertId>`) for efficient lookups.
Broadcasts `ALERT_ASSIGNED` event over SSE with `prevAssignee` tracking for
re-assignments. Returns `{ ok, alertId, assignee, assignedAt, alertFound }`.

### unassignAlert277(alertId, opts)

Removes an alert assignment. Cleans up the reverse index. Broadcasts
`ALERT_UNASSIGNED` event over SSE. Returns `{ ok, alertId, unassignedAt, prevAssignee }`.

### getAssignedAlerts277(assignee, opts)

Returns alerts assigned to a specific operator. Uses the reverse assignee index
for efficient lookup. Filters out resolved alerts by default; supports
`includeResolved: true`. Returns `{ ok, assignee, alerts, total }`.

### getEscalatedAlerts277(opts)

Returns all escalated, unresolved alerts. Supports optional filtering by `priority`
(`'HIGH'` | `'CRITICAL'`) and `since` (ISO timestamp). Returns `{ ok, alerts, total }`.

### SSE escalation stream

`addEscalationSseClient277(res)` registers an Express response as an escalation
SSE client (max 200). On connect, last 10 events sent as `event: history`.
Subsequent escalation/assignment/de-escalation events arrive as `event: escalation`.
Heartbeat every 30 s.

### DB persistence (optional)

When a `db` pool is injected:
- `escalateAlert277` persists to `credit_alert_escalations277` (upsert).
- `assignAlert277` persists to `credit_alert_assignments277` (upsert).
Schema DDL exported as `CREDIT_ALERT_ESCALATIONS_TABLE_277` and
`CREDIT_ALERT_ASSIGNMENTS_TABLE_277`. Best-effort — never throws.

### Telemetry

- `checkAlertEscalationHealth277()` — `{ ok, version, escalations, assignments, assignees, sseClients, eventHistory }`
- `getStatus277()` — full status object
- `getEventHistory277(opts)` — escalation event log (capped at 500)

---

## New: `providerAdapters277.js` (src/lib + lib mirror)

Extends providerAdapters276 with one new DI contract:

| Contract key | Required methods |
|---|---|
| `alertEscalation` | `escalateAlert277`, `assignAlert277`, `getAssignedAlerts277`, `getEscalatedAlerts277`, `addEscalationSseClient277`, `removeEscalationSseClient277`, `getStatus277` |

Total contracts: **27** (26 from V276 + 1 new).

`createAlertEscalationStub277()` and `createAllStubs277()` provide
test-safe factory functions.

---

## New: `ecos-api-server-v277-patch.js`

### New V277 endpoints

| Method | Path | Description |
|---|---|---|
| GET  | `/api/v277/health`                           | Full health + escalation status |
| GET  | `/api/v277/perf`                             | Aggregate perf telemetry |
| POST | `/api/v277/providers/validate`               | 27-contract validation |
| POST | `/api/v277/alerts/:alertId/escalate`         | **Escalate alert to operator/team** |
| POST | `/api/v277/alerts/:alertId/deescalate`       | **De-escalate alert** |
| POST | `/api/v277/alerts/:alertId/assign`           | **Assign alert to operator** |
| POST | `/api/v277/alerts/:alertId/unassign`         | **Unassign alert** |
| GET  | `/api/v277/alerts/assigned/:assignee`        | **Alerts assigned to operator** |
| GET  | `/api/v277/alerts/escalated`                 | **Escalated unresolved alerts** |
| GET  | `/api/v277/alerts/escalation/subscribe`      | **SSE escalation/assignment stream** |
| GET  | `/api/v277/alerts/escalation/history`        | Escalation event history |
| GET  | `/api/v277/alerts/status`                    | Bus + resolution + escalation status |

### All V276 routes preserved (backward compatible)

---

## New: Test Suite — `tests/v277.test.cjs`

Self-running suite covering:

- A. Version stamps (package.json, .agent-identity.json)
- B. New module files + lib mirrors
- C. escalateAlert277 + deescalateAlert277 — priority, bus mutation, error cases
- D. assignAlert277 + unassignAlert277 — assignment tracking, reverse index
- E. getAssignedAlerts277 — filtering, includeResolved, unknown assignee
- F. getEscalatedAlerts277 — priority filtering, resolved exclusion
- G. SSE client management (add, remove, broadcast, heartbeat, shutdown)
- H. Event history + getStatus277 + health check
- I. providerAdapters277 (27 contracts, stub validation, pass/fail)
- J. API patch (createV277State, route registration, V276 backward compat)
- K. Release documentation
- L. Sacred file integrity (MD5 verified)

---

## Dependencies

Zero new npm dependencies. All V277 code uses Node.js built-ins only.

---

## Identifier Convention

All new exports, constants, methods, and class names end with the suffix `277`.
No V276 identifier is removed or renamed.
