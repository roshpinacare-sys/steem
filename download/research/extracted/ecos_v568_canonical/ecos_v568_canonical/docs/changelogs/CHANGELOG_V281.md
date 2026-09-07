# ECOS V281 Changelog

**Release date:** 2026-06-01
**Branch:** canonical
**Baseline:** V280 (all V280 tests passing)

---

## Summary

V281 is a purely **additive** release. No V280 module signatures, exports, or
behaviour are changed. All V280 tests continue to pass unchanged.

---

## New: `digestScheduler281.js` (src/lib + lib mirror)

Scheduled digest + notification cycles — built on top of V280's notification channel
delivery pipeline.

### registerDigestSchedule281(name, opts)

Registers a recurring digest+notify schedule by name. Accepts:
- `intervalMs` — run interval in ms (minimum 5000)
- `channels` — array of channel names to notify (empty = all)
- `period` — digest period label passed to `generateAlertDigest279` (default: `'scheduled'`)
- `includeResolved` — include resolved alerts in digest (default: `false`)
- `force` — bypass channel filters on notify (default: `false`)
- `runImmediately` — run once immediately on register (default: `false`)

Returns `{ ok, name, intervalMs, channels, period, paused, registeredAt, version }`.
Broadcasts `SCHEDULE_REGISTERED` event over the SSE stream.

### deregisterDigestSchedule281(name)

Removes a schedule and cancels its timer. Broadcasts `SCHEDULE_REMOVED` over SSE.
Returns `{ ok, name, version }`.

### pauseSchedule281(name)

Pauses a running schedule (timer cancelled; config preserved).
Broadcasts `SCHEDULE_PAUSED` over SSE.
Returns `{ ok, name, paused: true, version }`.

### resumeSchedule281(name)

Resumes a paused schedule, restarting the interval timer.
Broadcasts `SCHEDULE_RESUMED` over SSE.
Returns `{ ok, name, paused: false, version }`.

### getSchedules281()

Lists all registered schedules with their current state.
Returns `{ ok, schedules, total, version }`.

### getScheduleHistory281(opts?)

Returns past run records (capped at 200). Accepts:
- `since` — ISO timestamp; only records newer than this
- `limit` — max results (default: 20)
- `schedule` — filter by schedule name

Returns `{ ok, runs, total, version }`.

Each run record carries:
`{ runId, name, ts, ok, digestId?, attempted?, delivered?, failed?, durationMs, error? }`

### getStatus281() / checkDigestSchedulerHealth281()

Both return `{ ok, version, activeSchedules, pausedSchedules, totalRuns, sseClients }`.
`checkDigestSchedulerHealth281()` also includes `pendingTimers`.

### getPerf281()

Returns latency percentiles `{ p50, p95, p99, count }` from the 1,000-sample ring buffer.

### addScheduleSseClient281(res) / removeScheduleSseClient281(clientId)

SSE client management. On connect, the client receives the current schedule list as an
initial `schedules` event. Subsequent events: `SCHEDULE_RUN_START`, `SCHEDULE_RUN_COMPLETE`,
`SCHEDULE_RUN_FAILED`, `SCHEDULE_REGISTERED`, `SCHEDULE_REMOVED`, `SCHEDULE_PAUSED`,
`SCHEDULE_RESUMED`, `heartbeat` (30 s interval).

### shutdown281()

Clears all interval timers, closes all SSE clients, stops heartbeat.

---

## New: `providerAdapters281.js` (src/lib + lib mirror)

Extends `providerAdapters280` with 1 new contract — **31 total**.

### Contract 31: `digestScheduler`

Required methods:
- `registerDigestSchedule281`
- `deregisterDigestSchedule281`
- `pauseSchedule281`
- `resumeSchedule281`
- `getSchedules281`
- `getScheduleHistory281`
- `getStatus281`

Optional: `checkDigestSchedulerHealth281`, `getPerf281`, `addScheduleSseClient281`,
`removeScheduleSseClient281`, `shutdown281`.

### createDigestSchedulerStub281()

Stub factory returning no-op implementations of all required + optional methods.

### createAllStubs281()

Extends `createAllStubs280()` with the `digestScheduler` stub.

---

## New: `ecos-api-server-v281-patch.js`

### createV281State(v280State, opts?)

Extends V280 state with `digestScheduler281` instance. Wires `alertDigest279` and
`notificationChannel280` from V280 state automatically.

### registerV281Routes(app, v281State, opts?)

Registers ten new routes on the Express app:

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v281/health`                          | Health + scheduler status |
| GET    | `/api/v281/perf`                            | Perf telemetry |
| POST   | `/api/v281/providers/validate`              | 31-contract validation |
| GET    | `/api/v281/alerts/schedules`                | List registered schedules |
| POST   | `/api/v281/alerts/schedules`                | Register a schedule |
| DELETE | `/api/v281/alerts/schedules/:name`          | Remove a schedule |
| POST   | `/api/v281/alerts/schedules/:name/pause`    | Pause a schedule |
| POST   | `/api/v281/alerts/schedules/:name/resume`   | Resume a schedule |
| GET    | `/api/v281/alerts/schedules/history`        | Schedule run history |
| GET    | `/api/v281/alerts/schedules/subscribe`      | SSE schedule event stream |

All V280 routes are preserved unchanged.

---

## Provider contract count

| Version | Contracts |
|---------|-----------|
| V279    | 29        |
| V280    | 30        |
| **V281**| **31**    |

---

## Iron-rule compliance

- ✅ Zero new npm deps (scheduler via `setInterval`/`setTimeout`, built-in only)
- ✅ All identifiers end in `281`
- ✅ No V280 identifier removed, renamed, or made breaking
- ✅ Sacred files untouched (`fiatLedger.js`, `auditLog.js`)
- ✅ `src/lib/` mirrors `lib/` for both new modules
