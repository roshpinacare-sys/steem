# Changelog — V257 (Phase P153) — Automation Dashboard + Persistent Scheduler + Full Cron

**Release:** ECOS V257 · 2026-06-01 · AI lead

## Direction
V256 introduced the automation scheduler and HITL resume. V257 completes the P153 milestone:
- **Automation Run Dashboard** — React artifact for live ops visibility.
- **Persistent Scheduler State** — scheduler survives server restarts via snapshotEngine.
- **Full 5-field Cron Expressions** — any standard cron expression now accepted.

---

## Feature — `cronParser257` (src/lib + lib mirror)

Pure Node.js cron parser, zero npm deps:

### parseCronExpression257(expr)
Parses a standard 5-field cron expression into Sets of matching values per field.
- Supports: `*`, `N`, `N-M`, `*/step`, `N-M/step`, comma-separated lists.
- Month names (`jan-dec`) and weekday names (`sun-sat`) accepted.
- Weekday 7 normalised to 0 (both = Sunday).
- Returns `{ ok:true, fields:{minute,hour,day,month,weekday} }` or `{ ok:false, error }`.

### isCronDue257(expr, date?)
Returns `true` if the given date (default: now) matches the expression (minute precision).

### nextCronFireMs257(expr, fromDate?)
Milliseconds until next fire from `fromDate` (default: now). Searches forward minute-by-minute,
max 527,040 iterations (~366 days). Returns `null` for invalid expressions.

---

## Feature — `automationScheduler257` (src/lib + lib mirror)

Supersedes V256 scheduler. Two key upgrades:

### P153-B: Persistent Scheduler State
On `start257()`, attempts to reload prior run stats (`lastRunAt`, `runCount`) from a
`snapshotEngine` instance (injected via `opts.snapshotEngine`). After each tick and on
`stop257()`, current state is persisted via `snapshotEngine.setExtra(key, state)`.
Gracefully degrades if no snapshotEngine is provided.

### P153-C: Full Cron Support via `parseCronOrInterval257(source)`
Tries legacy V256 shortcuts first (back-compat), then falls back to full 5-field cron via
`cronParser257`. Supports `cron: <expr>` notation and bare 5-field expressions embedded in
the recipe's `source` string.

Cron-triggered automations use `setTimeout` (recalculated each tick) rather than fixed
`setInterval`, so they always fire at the correct wall-clock time.

---

## Feature — `automationDashboard257.jsx` (artifacts/)

React artifact (P153-A). Connects to the ECOS API server and shows:
- **Stats row** — automation count, scheduler status, HITL pending.
- **Scheduler status** — live/idle, start/stop controls, per-entry details.
- **HITL queue** — paused runs with one-click Resume button.
- **All automations** — expandable list showing trigger, tags, run count, run history.
- **Event log** — inline stream of resume and scheduler events.
- Auto-refreshes every 30s. Configurable base URL.

---

## API

| Method | Path | Tag | Description |
|--------|------|-----|-------------|
| `POST` | `/api/v1/admin/scheduler257/start`  | V257-T01 | Start scheduler257 (restores persisted state) |
| `POST` | `/api/v1/admin/scheduler257/stop`   | V257-T02 | Stop + persist state |
| `GET`  | `/api/v1/admin/scheduler257/status` | V257-T03 | Scheduler257 status + entry list |
| `POST` | `/api/v1/admin/cron257/parse`       | V257-T04 | Parse + validate cron expression |
| `POST` | `/api/v1/admin/cron257/next`        | V257-T05 | Next N fire times for an expression |
| `GET`  | `/api/v1/admin/summary/v257`        | V257-T06 | V257 summary |

Note: V256 scheduler endpoints (`/api/v1/admin/scheduler/…`) remain intact (R4).

---

## Verification
- `node --check` clean on all new files.
- `tests/v257.test.js` — **43 tests, all pass**.
- V255 (`tests/v255.test.js`) — 18 pass. V254 (`tests/v254.test.js`) — 19 pass.
- Sacred files UNTOUCHED (R1): fiatLedger `563e9b1f…` · auditLog `e5a5c2c2…`.
- Zero new npm deps (R6).
- All existing V256 endpoints preserved (R4).

## New files
| File | Purpose |
|------|---------|
| `src/lib/cronParser257.js` | Full 5-field cron evaluator |
| `lib/cronParser257.js` | Mirror |
| `src/lib/automationScheduler257.js` | Persistent scheduler + cron support |
| `lib/automationScheduler257.js` | Mirror |
| `ecos-api-server-v257-patch.js` | Express endpoint registrar |
| `artifacts/automationDashboard257.jsx` | React dashboard artifact |
| `tests/v257.test.js` | 43 tests |

## Breaking changes
None. Additive only.

## Next
- Wire `automationScheduler257` auto-start into `ecos-api-server.js` `_wireAutomationRunner257()` IIFE.
- Gumloop populates catalog with real schedule+webhook automations.
- WebSocket push for live HITL notifications in the dashboard.
- `snapshotEngine.setExtra/getExtra` integration into the real SnapshotEngine class.
