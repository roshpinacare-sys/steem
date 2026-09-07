# ECOS V276 Changelog

**Release date:** 2026-06-01
**Branch:** canonical
**Baseline:** V275 (all V275 tests passing)

---

## Summary

V276 is a purely **additive** release. No V275 module signatures, exports, or
behaviour are changed. All V275 tests continue to pass unchanged.

---

## New: `alertResolution276.js` (src/lib + lib mirror)

Alert lifecycle management — resolution and operator acknowledgement on top of
the V275 Counter Alert Bus.

### resolveAlert276(alertId, meta)

Marks an alert as resolved. Updates the alert in CounterAlertBus275 history
(sets `resolved: true`, `resolvedAt`, `resolvedBy`), stores resolution metadata,
broadcasts a `ALERT_RESOLVED` event over the resolution SSE stream.
Returns `{ ok, alertId, resolvedAt, alertFound }`.

### acknowledgeAlert276(alertId, meta)

Operator acknowledgement (seen, not yet resolved). Sets `acknowledged: true` and
`acknowledgedAt` on the bus history entry. Broadcasts `ALERT_ACKNOWLEDGED` over SSE.

### getUnresolved276(opts)

Returns only active unresolved alerts from CounterAlertBus275 history.
Supports filtering by `alertType`, `since`, and `limit`.

### wireManualOverride276() / unwireManualOverride276()

Wraps `manualOverride273.applyManualOverride273` (or equivalent) with a
non-breaking hook. Every manual override fires a `MANUAL_OVERRIDE` alert event
into both the counter alert bus history and the resolution SSE stream, so
operators can see overrides in the live alert feed.

### SSE resolution stream

`addResolutionSseClient276(res)` registers an Express response as a resolution
SSE client (max 200). On connect, last 10 events sent as `event: history`.
Subsequent resolution/acknowledgement/override events arrive as `event: resolution`.
Heartbeat every 30 s.

### DB persistence (optional)

When a `db` pool is injected, `resolveAlert276` persists resolutions to
`credit_alert_history276` table (upsert). Schema DDL exported as
`CREDIT_ALERT_HISTORY_TABLE_276`. Best-effort — never throws.

### Telemetry

- `checkAlertResolutionHealth276()` — `{ ok, version, wiredOverride, sseClients, eventHistory, resolutions }`
- `getStatus276()` — full status object
- `getEventHistory276(opts)` — resolution event log (capped at 500)

---

## New: `providerAdapters276.js` (src/lib + lib mirror)

Extends providerAdapters275 with one new DI contract:

| Contract key | Required methods |
|---|---|
| `alertResolution` | `resolveAlert276`, `acknowledgeAlert276`, `getUnresolved276`, `wireManualOverride276`, `unwireManualOverride276`, `addResolutionSseClient276`, `removeResolutionSseClient276`, `getStatus276` |

Total contracts: **26** (25 from V275 + 1 new).

`createAlertResolutionStub276()` and `createAllStubs276()` provide
test-safe factory functions.

---

## New: `ecos-api-server-v276-patch.js`

### New V276 endpoints

| Method | Path | Description |
|---|---|---|
| GET  | `/api/v276/health`                         | Full health + alert resolution status |
| GET  | `/api/v276/perf`                           | Aggregate perf telemetry |
| POST | `/api/v276/providers/validate`             | 26-contract validation |
| POST | `/api/v276/alerts/:alertId/resolve`        | **Mark alert as resolved** |
| POST | `/api/v276/alerts/:alertId/acknowledge`    | **Mark alert as acknowledged** |
| GET  | `/api/v276/alerts/unresolved`              | **Active unresolved alerts only** |
| GET  | `/api/v276/alerts/resolution/subscribe`    | **SSE resolution event stream** |
| GET  | `/api/v276/alerts/resolution/history`      | Resolution event history |
| GET  | `/api/v276/alerts/status`                  | Alert bus + resolution status |

### All V275 routes preserved (backward compatible)

---

## New: Test Suite — `tests/v276.test.cjs`

Self-running suite covering:

- A. Version stamps (package.json, .agent-identity.json)
- B. New module files + lib mirrors
- C. resolveAlert276 + acknowledgeAlert276 — correct mutation of bus history
- D. getUnresolved276 — filtering, no-bus graceful
- E. wireManualOverride276 — hook wiring, idempotent, original still called
- F. SSE client management (add, remove, broadcast, heartbeat, shutdown)
- G. Event history + getStatus276 + health check
- H. providerAdapters276 (26 contracts, stub validation, pass/fail)
- I. API patch (createV276State, route registration, V275 backward compat)
- J. Release documentation
- K. Sacred file integrity (MD5 verified)

---

## Dependencies

Zero new npm dependencies. All V276 code uses Node.js built-ins only.

---

## Identifier Convention

All new exports, constants, methods, and class names end with the suffix `276`.
No V275 identifier is removed or renamed.
