# ECOS V275 Changelog

**Release date:** 2026-06-01
**Branch:** canonical
**Baseline:** V274 (all V274 tests passing)

---

## Summary

V275 is a purely **additive** release. No V274 module signatures, exports, or
behaviour are changed. All V274 tests continue to pass unchanged.

---

## New: `counterAlertBus275.js` (src/lib + lib mirror)

The Counter Alert Bus subscribes to the V274 SSE counter stream and fires
configurable alert handlers when thresholds are crossed.

### Default thresholds

| Threshold | Default | Alert type |
|---|---|---|
| `sybilFailRate > 0.15` | 15% | `SYBIL_FAIL_RATE` |
| `tipCircularity > 0.90` | 90% | `TIP_CIRCULARITY` |
| `halt_issuance = true` | true | `HALT_ISSUANCE` |
| `pause_rewards = true` | true | `PAUSE_REWARDS` |

All thresholds are configurable via constructor `opts.thresholds` or the
`POST /api/v275/alerts/thresholds` endpoint at runtime.

### Subscription

`subscribe275()` wraps `EventFeedBridge274._broadcastCounterUpdate274` with a
non-breaking additive hook. Every time the bridge broadcasts a counter event,
the alert bus evaluates thresholds against live `CreditHealthMonitor273` health
data and fires any appropriate alerts.

### Alert lifecycle

- Cooldown of **10 s** between same-type alerts prevents flooding.
- Alerts are stored in a capped in-memory history (latest **500**).
- Registered `onAlert275` handlers are called synchronously (errors swallowed).
- Alert events broadcast over SSE to all subscribed dashboard clients.

### SSE stream

`addAlertSseClient275(res)` registers an Express response as an SSE alert client.
On connect, the last 10 alerts are sent immediately as an `event: history` message.
Subsequent alerts arrive as `event: alert` messages. Heartbeat every 30 s.
Max **200** concurrent clients.

### Telemetry

- `getPerf275()` — `{ p50, p95, p99, count }` latency percentiles for threshold evaluation
- `checkCounterAlertBusHealth275()` — `{ ok, version, subscribed, sseClients, historyCount, thresholds }`
- `getStatus275()` — full status including lastFired timestamps per alert type

---

## New: `providerAdapters275.js` (src/lib + lib mirror)

Extends providerAdapters274 with one new DI contract:

| Contract key | Required methods |
|---|---|
| `counterAlertBus` | `subscribe275`, `unsubscribe275`, `onAlert275`, `offAlert275`, `addAlertSseClient275`, `removeAlertSseClient275`, `getHistory275`, `getStatus275` |

Total contracts: **25** (24 from V274 + 1 new).

`createCounterAlertBusStub275()` and `createAllStubs275()` provide
test-safe factory functions.

---

## New: `ecos-api-server-v275-patch.js`

### New V275 endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/v275/health` | Full health + credit health + bridge + alert bus status |
| GET | `/api/v275/perf` | Aggregate perf telemetry incl. alert bus |
| POST | `/api/v275/providers/validate` | 25-contract validation |
| GET | `/api/v275/alerts/subscribe` | **SSE real-time alert stream** |
| GET | `/api/v275/alerts/history` | Recent alert history (filterable) |
| GET | `/api/v275/alerts/thresholds` | Current threshold config |
| POST | `/api/v275/alerts/thresholds` | Update thresholds at runtime |
| GET | `/api/v275/credit-health/dashboard` | **Combined counters + directives + alerts** |
| GET | `/api/v275/alerts/status` | Alert bus status |

### All V274 routes preserved (backward compatible)

---

## New: Test Suite — `tests/v275.test.cjs`

Self-running suite covering:

- A. Version stamps (package.json, .agent-identity.json)
- B. New module files + lib mirrors
- C. Threshold evaluation + alert firing + cooldown
- D. SSE client management (add, remove, broadcast)
- E. Subscription to EventFeedBridge274 (hook wiring + unsubscribe)
- F. Alert history + getStatus275
- G. providerAdapters275 (25 contracts, stub validation)
- H. API patch (createV275State, route registration)
- I. Release documentation
- J. Sacred file integrity (md5 verified)

---

## Dependencies

Zero new npm dependencies. All V275 code uses Node.js built-ins only.

---

## Identifier Convention

All new exports, constants, methods, and class names end with the suffix `275`.
No V274 identifier is removed or renamed.
