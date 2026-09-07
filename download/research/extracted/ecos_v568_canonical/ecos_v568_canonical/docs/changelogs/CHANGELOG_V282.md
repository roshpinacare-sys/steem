# ECOS V282 Changelog

**Release date:** 2026-06-01
**Branch:** canonical
**Baseline:** V281 (all V281 tests passing)

---

## Summary

V282 is a purely **additive** release. No V281 module signatures, exports, or
behaviour are changed. All V281 tests continue to pass unchanged.

---

## New: `notificationTemplate282.js` (src/lib + lib mirror)

Notification templates with Mustache-style rendering — built on top of V281's
scheduled digest + notification delivery pipeline.

### registerNotificationTemplate282(name, opts)

Registers a named notification template. Accepts:
- `subject`      — subject line template (supports `{{var}}` placeholders)
- `body`         — body template (required; supports `{{var}}` placeholders)
- `contentType`  — `'json'` | `'text'` (default: `'text'`)
- `description`  — human-readable description (optional)

Returns `{ ok, name, contentType, registeredAt, version }`.

### deregisterNotificationTemplate282(name)

Removes a registered template by name.
Returns `{ ok, name, version }`.

### getTemplates282()

Lists all registered templates with their full config.
Returns `{ ok, templates, total, version }`.

### getTemplate282(name)

Gets a single template by name.
Returns `{ ok, template, version }` or `{ ok: false, error, version }`.

### renderTemplate282(name, context)

Renders a template with a key-value context object.
`{{key}}` placeholders are replaced with `context[key]`; unknown keys → empty string.
Returns `{ ok, name, subject, body, contentType, version }`.

### previewTemplate282(name, sampleDigest)

Renders a template with a sample digest object as the context.
Top-level scalar fields of `sampleDigest` are flattened into the substitution context.
Returns `{ ok, name, subject, body, contentType, sampleContext, version }`.

### getStatus282() / checkNotificationTemplateHealth282()

Both return `{ ok, version, templateCount }`.

### getPerf282()

Returns latency percentiles `{ p50, p95, p99, count }` from the 1,000-sample ring buffer.

---

## New: `providerAdapters282.js` (src/lib + lib mirror)

Extends `providerAdapters281` with 1 new contract — **32 total**.

### Contract 32: `notificationTemplate`

Required methods:
- `registerNotificationTemplate282`
- `deregisterNotificationTemplate282`
- `getTemplates282`
- `getTemplate282`
- `renderTemplate282`
- `getStatus282`

Optional: `previewTemplate282`, `checkNotificationTemplateHealth282`, `getPerf282`.

### createNotificationTemplateStub282()

Stub factory returning no-op implementations of all required + optional methods.

### createAllStubs282()

Extends `createAllStubs281()` with the `notificationTemplate` stub.

---

## New: `ecos-api-server-v282-patch.js`

### createV282State(v281State, opts?)

Extends V281 state with `notificationTemplate282` instance.

### registerV282Routes(app, v282State, opts?)

Registers nine new routes on the Express app:

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v282/health`                              | Health + template engine status |
| GET    | `/api/v282/perf`                                | Perf telemetry |
| POST   | `/api/v282/providers/validate`                  | 32-contract validation |
| GET    | `/api/v282/alerts/templates`                    | List registered templates |
| POST   | `/api/v282/alerts/templates`                    | Register a template |
| GET    | `/api/v282/alerts/templates/:name`              | Get a single template |
| DELETE | `/api/v282/alerts/templates/:name`              | Remove a template |
| POST   | `/api/v282/alerts/templates/:name/render`       | Render template with context |
| POST   | `/api/v282/alerts/templates/:name/preview`      | Preview template with sample digest |

All V281 routes are preserved unchanged.

---

## Provider contract count

| Version | Contracts |
|---------|-----------|
| V280    | 30        |
| V281    | 31        |
| **V282**| **32**    |

---

## Iron-rule compliance

- ✅ Zero new npm deps (Mustache rendering via native `String.replace`, built-in only)
- ✅ All identifiers end in `282`
- ✅ No V281 identifier removed, renamed, or made breaking
- ✅ Sacred files untouched (`fiatLedger.js`, `auditLog.js`)
- ✅ `src/lib/` mirrors `lib/` for both new modules
