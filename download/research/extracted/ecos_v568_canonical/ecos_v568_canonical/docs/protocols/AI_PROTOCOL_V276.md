# ECOS AI Protocol — V276

**Version:** 276
**Date:** 2026-06-01
**Status:** Canonical

---

## 1. Overview

V276 extends the ECOS AI protocol with alert lifecycle management:

**Alert resolution** — operators can resolve and acknowledge alerts from the
V275 Counter Alert Bus. Resolved alerts remain in history but are flagged.
Resolutions broadcast over a dedicated SSE stream. Manual overrides from
manualOverride273 are wired through the alert bus as observable events.

---

## 2. AlertResolution276 Protocol

### 2.1 resolveAlert276(alertId, meta?)

```js
alertResolution.resolveAlert276('alert-uuid', { resolvedBy: 'alice', note: 'fixed' });
// → { ok, alertId, resolvedAt, alertFound }
```

Updates the alert in CounterAlertBus275 `_history275` array:
- Sets `resolved: true`, `resolvedAt`, `resolvedBy`, `resolveNote`
- Broadcasts `ALERT_RESOLVED` over resolution SSE stream
- Persists to DB when `db` pool injected (optional)

### 2.2 acknowledgeAlert276(alertId, meta?)

```js
alertResolution.acknowledgeAlert276('alert-uuid', { ackedBy: 'bob' });
// → { ok, alertId, ackedAt, alertFound }
```

Marks `acknowledged: true`, `acknowledgedAt`, `acknowledgedBy` on bus history entry.
Broadcasts `ALERT_ACKNOWLEDGED` over resolution SSE stream.

### 2.3 getUnresolved276(opts?)

```js
alertResolution.getUnresolved276({ alertType: 'SYBIL_FAIL_RATE', limit: 50 });
// → { ok, alerts: [...], total, unresolved }
```

Filters CounterAlertBus275 history for `resolved: false` entries.
Supports `alertType`, `since`, and `limit` query parameters.

### 2.4 Manual Override Wiring

```js
alertResolution.wireManualOverride276();
// → Wraps manualOverride273.applyManualOverride273 (additive, non-breaking)
// Every manual override fires MANUAL_OVERRIDE alert event into bus + resolution SSE
alertResolution.unwireManualOverride276();
// → Restores original function
```

### 2.5 SSE resolution stream

```
event: history   (on connect — last 10 resolution events)
data: { "events": [...], "count": N }

event: resolution  (on each resolve/ack/override)
data: { "eventType": "ALERT_RESOLVED|ALERT_ACKNOWLEDGED|MANUAL_OVERRIDE",
        "data": {...}, "ecosVersion": "276", "ts": "..." }

: heartbeat      (every 30 s)
```

### 2.6 DB persistence (optional)

```sql
CREATE TABLE IF NOT EXISTS credit_alert_history276 (
  alert_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

When `db` pool injected into `AlertResolution276`, resolutions are upserted
into this table on every `resolveAlert276` call. Best-effort, never throws.

---

## 3. New Provider Contract

```
PROVIDER_CONTRACTS_276['alertResolution'] = {
  required: ['resolveAlert276', 'acknowledgeAlert276', 'getUnresolved276',
             'wireManualOverride276', 'unwireManualOverride276',
             'addResolutionSseClient276', 'removeResolutionSseClient276', 'getStatus276'],
  optional: ['startResolutionHeartbeat276', 'checkAlertResolutionHealth276',
             'getEventHistory276', 'shutdown276'],
}
```

Total DI contracts: **26** (25 from V275 + 1 new).

---

## 4. V276 API Endpoints

| Method | Path | Description |
|---|---|---|
| GET  | `/api/v276/health`                      | Health + alert resolution status |
| GET  | `/api/v276/perf`                        | Aggregate perf |
| POST | `/api/v276/providers/validate`          | 26-contract validation |
| POST | `/api/v276/alerts/:alertId/resolve`     | Mark alert resolved |
| POST | `/api/v276/alerts/:alertId/acknowledge` | Mark alert acknowledged |
| GET  | `/api/v276/alerts/unresolved`           | Active unresolved alerts |
| GET  | `/api/v276/alerts/resolution/subscribe` | SSE resolution event stream |
| GET  | `/api/v276/alerts/resolution/history`   | Resolution event history |
| GET  | `/api/v276/alerts/status`               | Alert bus + resolution status |

---

## 5. Versioning Rules

- All new identifiers in V276 end with the suffix `276`.
- No V275 identifier is removed, renamed, or made breaking.
- V276 modules are drop-in additions alongside V275 modules.
- Future versions (V277+) MUST follow the same additive-only, suffix-versioned pattern.

---

## 6. Security Constraints (inherited + new)

| Constraint | Enforcement |
|---|---|
| Override hook non-breaking | Original `applyManualOverride273` always called; hook errors swallowed |
| SSE capacity | Max 200 concurrent resolution SSE clients |
| DB best-effort | DB persistence never blocks or throws |
| Alert cooldown (inherited) | Min 10 s between same-type alerts (from CounterAlertBus275) |
| No self-attestation (inherited) | From reputationLedger268 |
| Sacred file guard (inherited) | injectionFirewall268 blocks writes to SACRED_FILES_268 |
| BigInt-only credits (inherited) | All μ¢ values use BigInt |
