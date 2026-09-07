# ECOS V283 Changelog

**Release date:** 2026-06-02
**Branch:** canonical
**Baseline:** V282 (all V282 tests passing)

---

## Summary

V283 is a purely **additive** release. No V282 module signatures, exports, or
behaviour are changed. All V282 tests continue to pass unchanged.

---

## New: `notificationChannel283.js` (src/lib + lib mirror)

Notification channel registry with template-bound delivery — built on top of V282's
notification template engine.

### registerNotificationChannel283(name, opts)

Registers a named notification channel. Accepts:
- `url`           — webhook URL (required)
- `templateName`  — optional V282 template to bind at registration
- `method`        — HTTP method (default: `'POST'`)
- `headers`       — extra HTTP headers object
- `description`   — human-readable description

Returns `{ ok, name, templateName, registeredAt, version }`.

### deregisterNotificationChannel283(name)

Removes a registered channel by name.
Returns `{ ok, name, version }`.

### setChannelTemplate283(channelName, templateName)

Binds or replaces the template for an existing channel.
Returns `{ ok, channelName, templateName, version }`.

### unsetChannelTemplate283(channelName)

Removes the template binding from a channel.
Returns `{ ok, channelName, version }`.

### getChannel283(name)

Gets a single channel by name.
Returns `{ ok, channel, version }` or `{ ok: false, error, version }`.

### getChannels283()

Lists all registered channels.
Returns `{ ok, channels, total, version }`.

### notifyDigest283(digest, opts)

Delivers a digest to all registered channels (or a single named channel via `opts.channel`).
If a channel has a bound template and a template engine is available, the digest is rendered
before delivery. Channels that fail rendering are skipped (not errored).
Returns `{ ok, delivered, skipped, errors, version }`.

### testChannel283(channelName, sampleDigest)

Dry-run: renders the bound template for a channel with a sample digest. Does not send.
Returns `{ ok, channelName, templateName, subject, body, contentType, version }`.

### getStatus283() / checkNotificationChannelHealth283()

Both return `{ ok, version, channelCount }`.

### getPerf283()

Returns latency percentiles `{ p50, p95, p99, count }` from the 1,000-sample ring buffer.

---

## New: `providerAdapters283.js` (src/lib + lib mirror)

Extends `providerAdapters282` with 1 new contract — **33 total**.

### Contract 33: `notificationChannel`

Required methods:
- `registerNotificationChannel283`
- `deregisterNotificationChannel283`
- `setChannelTemplate283`
- `unsetChannelTemplate283`
- `getChannel283`
- `getChannels283`
- `notifyDigest283`
- `getStatus283`

Optional: `testChannel283`, `checkNotificationChannelHealth283`, `getPerf283`.

### createNotificationChannelStub283()

Stub factory returning no-op implementations of all required + optional methods.

### createAllStubs283()

Extends `createAllStubs282()` with the `notificationChannel` stub.

---

## New: `ecos-api-server-v283-patch.js`

### createV283State(v282State, opts?)

Extends V282 state with `notificationChannel283` instance, passing the V282 template engine
through for template-bound delivery.

### registerV283Routes(app, v283State, opts?)

Registers eleven new routes on the Express app:

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v283/health`                              | Health + channel engine status |
| GET    | `/api/v283/perf`                                | Perf telemetry |
| POST   | `/api/v283/providers/validate`                  | 33-contract validation |
| GET    | `/api/v283/alerts/channels`                     | List registered channels |
| POST   | `/api/v283/alerts/channels`                     | Register a channel |
| GET    | `/api/v283/alerts/channels/:name`               | Get a single channel |
| DELETE | `/api/v283/alerts/channels/:name`               | Remove a channel |
| GET    | `/api/v283/alerts/channels/:name/template`      | Show bound template |
| PUT    | `/api/v283/alerts/channels/:name/template`      | Bind/change template |
| DELETE | `/api/v283/alerts/channels/:name/template`      | Unbind template |
| POST   | `/api/v283/alerts/channels/notify`              | Deliver digest to all channels |
| POST   | `/api/v283/alerts/channels/:name/test`          | Dry-run delivery with rendering |

All V282 routes are preserved unchanged.

---

## Provider contract count

| Version | Contracts |
|---------|-----------|
| V281    | 31        |
| V282    | 32        |
| **V283**| **33**    |

---

## Iron-rule compliance

- ✅ Zero new npm deps (channel/delivery logic built-in only)
- ✅ All identifiers end in `283`
- ✅ No V282 identifier removed, renamed, or made breaking
- ✅ Sacred files untouched (`fiatLedger.js`, `auditLog.js`)
- ✅ `src/lib/` mirrors `lib/` for both new modules
