# ECOS AI Protocol — V275

**Version:** 275
**Date:** 2026-06-01
**Status:** Canonical

---

## 1. Overview

V275 extends the ECOS AI protocol with one new dimension:

**Counter alerting** — the `CounterAlertBus275` subscribes to the V274 SSE counter
stream and fires configurable alert handlers whenever health thresholds are crossed.
It also provides a unified dashboard endpoint combining counters, directives, and recent
alerts in a single mobile-friendly payload.

---

## 2. CounterAlertBus275 Protocol

### 2.1 Default thresholds

| Threshold | Default | Alert type |
|---|---|---|
| `sybilFailRate > 0.15` | 15% | `SYBIL_FAIL_RATE` |
| `tipCircularity > 0.90` | 90% | `TIP_CIRCULARITY` |
| `halt_issuance = true` | true | `HALT_ISSUANCE` |
| `pause_rewards = true` | true | `PAUSE_REWARDS` |

Thresholds are configurable via constructor `opts.thresholds` or `POST /api/v275/alerts/thresholds`.

### 2.2 Subscription pattern

```js
// CounterAlertBus275 wraps EventFeedBridge274._broadcastCounterUpdate274
// with an additive, non-breaking hook:
alertBus.subscribe275();
// → alerts auto-fire whenever bridge broadcasts a counter update
```

### 2.3 Alert lifecycle

```
CounterEvent (sybilEval | tip)
  │─── EventFeedBridge274._broadcastCounterUpdate274()
  │─── CounterAlertBus275._onCounterEvent275()
  │      ├─ Pull live health from CreditHealthMonitor273.checkHealth273()
  │      ├─ Evaluate sybilFailRate threshold
  │      ├─ Evaluate tipCircularity threshold
  │      ├─ Evaluate halt_issuance directive
  │      └─ Evaluate pause_rewards directive
  │─── _maybeFireAlert275(alertType, context)
  │      ├─ Cooldown check (10 s default)
  │      ├─ _buildAlert275() → { alertId, alertType, ts, context, resolved: false }
  │      ├─ Push to _history275 (capped at 500)
  │      ├─ Fire registered onAlert275 handlers
  │      └─ _broadcastAlert275() → SSE clients
```

### 2.4 Alert history

```js
alertBus.getHistory275({ alertType?, since?, limit? })
// → { ok, alerts: [...], total, filtered }
```

History is capped at `ALERT_HISTORY_MAX_275 = 500` entries (oldest discarded).

### 2.5 SSE alert stream

```
event: history   (on connect — last 10 alerts)
data: { "alerts": [...], "count": N }

event: alert     (on each new alert)
data: { "alertId": "...", "alertType": "...", "ts": "...", "context": {...}, "resolved": false }

: heartbeat      (every 30 s)
```

---

## 3. Dashboard Endpoint Protocol

`GET /api/v275/credit-health/dashboard` returns a single mobile-friendly payload:

```json
{
  "ok": true,
  "ecosVersion": "275",
  "ts": "<ISO-8601>",
  "counters": { "sybilFailRate": 0.04, "tipCircularity": 0.12, ... },
  "directives": { "halt_issuance": false, "pause_rewards": false },
  "thresholds": { ... },
  "alerts": {
    "recent": [ ... ],
    "totalFired": 3,
    "thresholds": { "sybilFailRate": 0.15, ... },
    "sseClients": 2
  },
  "bridgeStatus": { ... }
}
```

---

## 4. New Provider Contract

```
PROVIDER_CONTRACTS_275['counterAlertBus'] = {
  required: ['subscribe275', 'unsubscribe275', 'onAlert275', 'offAlert275',
             'addAlertSseClient275', 'removeAlertSseClient275', 'getHistory275', 'getStatus275'],
  optional: ['startAlertHeartbeat275', 'getPerf275', 'checkCounterAlertBusHealth275', 'shutdown275'],
}
```

Total DI contracts: **25** (24 from V274 + 1 new).

---

## 5. Versioning Rules

- All new identifiers in V275 end with the suffix `275`.
- No V274 identifier is removed, renamed, or made breaking.
- V275 modules are drop-in additions alongside V274 modules.
- Future versions (V276+) MUST follow the same additive-only, suffix-versioned pattern.

---

## 6. Security Constraints (inherited + new)

| Constraint | Enforcement |
|---|---|
| Alert cooldown | Min 10 s between same-type alerts prevents alert flooding |
| SSE capacity | Max 200 concurrent alert SSE clients |
| Hook non-breaking | Original `_broadcastCounterUpdate274` always called; hook result discarded on error |
| No self-attestation | Inherited from reputationLedger268 |
| No self-tipping | Inherited from tipModule268 |
| Sacred file guard | injectionFirewall268 blocks writes to SACRED_FILES_268 |
| BigInt-only credits | All μ¢ values use BigInt |
