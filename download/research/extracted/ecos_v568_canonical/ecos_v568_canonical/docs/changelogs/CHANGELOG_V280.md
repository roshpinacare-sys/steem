# ECOS V280 Changelog

**Release date:** 2026-06-01
**Branch:** canonical
**Baseline:** V279 (all V279 tests passing)

---

## Summary

V280 is a purely **additive** release. No V279 module signatures, exports, or
behaviour are changed. All V279 tests continue to pass unchanged.

---

## New: `notificationChannel280.js` (src/lib + lib mirror)

Alert notification delivery — built on top of the V279 digest pipeline.

### registerNotificationChannel280(name, opts)

Registers a notification channel by name. Accepts:
- `url` — webhook URL to POST digest JSON to (optional; omit for in-memory channel)
- `alertTypes` — array of alert type strings to filter on (empty = all types)
- `minSeverity` — `'INFO'` | `'WARNING'` | `'CRITICAL'` (default: `'INFO'`)
- `onlyBreached` — only notify when `digest.breached > 0` (default: `false`)
- `maxRetries` — max delivery attempts (default: 3)

Returns `{ ok, name, url, alertTypes, minSeverity, onlyBreached, maxRetries, registeredAt }`.
Broadcasts `CHANNEL_REGISTERED` event over the SSE stream.

### deregisterNotificationChannel280(name)

Removes a channel from the registry. Broadcasts `CHANNEL_REMOVED` over SSE.
Returns `{ ok, name }`.

### notifyDigest280(digest, opts?)

Delivers a digest object to all registered channels whose filters match. Accepts:
- `digest` — a digest produced by `generateAlertDigest279()`
- `opts.force` — bypass all channel filters (default: `false`)

For each matching channel with a `url`, POSTs the digest as JSON. Channels
without a `url` are treated as in-memory (delivery recorded immediately as ok).

Returns:
```
{ ok, attempted, delivered, failed, deliveries, version, ts }
```

Each entry in `deliveries` carries `{ ok, deliveryId, channel, attempt, status?, reason?, ts }`.

### Retry logic

When a webhook POST fails (network error or non-2xx HTTP), delivery is retried
up to `channel.maxRetries` times using `setTimeout`-based back-off
(`retryDelayMs × attempt`). No new npm deps — only `setTimeout` from the Node
runtime. Pending retries are tracked in `_retryTimers280` and cleared on
`shutdown280()`.

### getChannels280()

Lists all registered channels. Returns `{ ok, channels, total }`.

### getNotificationHistory280(opts?)

Returns past delivery records (capped at 200). Accepts:
- `since` — ISO timestamp; only records newer than this
- `limit` — max results (default: 20)
- `channel` — filter by channel name

Returns `{ ok, deliveries, total }`.

### getStatus280() / checkNotificationChannelHealth280()

Both return `{ ok, version, channelCount, deliveryCount, pendingRetries, sseClients }`.

### getPerf280()

Returns latency percentiles `{ p50, p95, p99, count }` from the 1,000-sample
ring buffer (same pattern as V268+ telemetry).

### addNotificationSseClient280(res) / removeNotificationSseClient280(clientId)

SSE client management. On connect, the client receives the current channel list
as an initial `channels` event. Subsequent events: `NOTIFICATION_DELIVERED`,
`NOTIFICATION_FAILED`, `NOTIFICATION_RETRY`, `CHANNEL_REGISTERED`,
`CHANNEL_REMOVED`, `heartbeat` (30 s interval).

### shutdown280()

Clears all retry timers, closes all SSE clients, stops heartbeat.

---

## New: `providerAdapters280.js` (src/lib + lib mirror)

Extends `providerAdapters279` with 1 new contract — **30 total**.

### Contract 30: `notificationChannel`

Required methods:
- `registerNotificationChannel280`
- `deregisterNotificationChannel280`
- `notifyDigest280`
- `getChannels280`
- `getNotificationHistory280`
- `getStatus280`
- `addNotificationSseClient280`
- `removeNotificationSseClient280`

Optional: `checkNotificationChannelHealth280`, `getPerf280`, `shutdown280`.

### createNotificationChannelStub280()

Stub factory returning no-op implementations of all required + optional methods.

### createAllStubs280()

Extends `createAllStubs279()` with the `notificationChannel` stub.

---

## New: `ecos-api-server-v280-patch.js`

### createV280State(v279State, opts?)

Extends V279 state with `notificationChannel280` instance. Wires `alertDigest279`
from V279 state so that `POST /api/v280/alerts/notify` can generate a fresh digest
before delivering.

### registerV280Routes(app, v280State, opts?)

Registers nine new routes on the Express app:

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v280/health` | Health + notification channel status |
| GET    | `/api/v280/perf` | Perf telemetry |
| POST   | `/api/v280/providers/validate` | 30-contract validation |
| GET    | `/api/v280/alerts/channels` | List registered channels |
| POST   | `/api/v280/alerts/channels` | Register a channel |
| DELETE | `/api/v280/alerts/channels/:name` | Remove a channel |
| POST   | `/api/v280/alerts/notify` | On-demand notification delivery |
| GET    | `/api/v280/alerts/notify/history` | Delivery history |
| GET    | `/api/v280/alerts/notify/subscribe` | SSE event stream |

All V279 routes are preserved unchanged.

---

## Provider contract count

| Version | Contracts |
|---------|-----------|
| V278    | 28        |
| V279    | 29        |
| **V280**| **30**    |

---

## Iron-rule compliance

- ✅ Zero new npm deps (retry via `setTimeout`, HTTP via `fetch` built-in)
- ✅ All identifiers end in `280`
- ✅ No V279 identifier removed, renamed, or made breaking
- ✅ Sacred files untouched (`fiatLedger.js`, `auditLog.js`)
- ✅ `src/lib/` mirrors `lib/` for both new modules
