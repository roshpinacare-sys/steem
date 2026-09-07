# ECOS Changelog — V157: Server Restore + Observability & WS Hardening

**Release Date:** 2026-05-30
**Version:** 157.0.0
**Release Name:** Server Restore + Observability & WS Hardening (P46)

---

## ⚠️ Critical fix first — BUG-K

While auditing for V157, the committed `ecos-api-server.js` was found to be
**corrupted and non-parseable** — the server could not start at all (V155 and
V156 shipped a broken main server file).

A shell wrapper artifact —
`__manus_ec=0; trap '' PIPE; printf %d:%sn 0 /home/ubuntu/ecos_v155 2>/dev/null >&3; trap - PIPE`
— had been injected **9 times**, each replacing a `!!` boolean coercion inside
the two `checks = { … }` objects of the `/api/v1/system/health` and
`/api/v1/system/readiness` handlers (e.g. `db: !!dbPool` became `db: <artifact>dbPool`).
`node --check` failed with `SyntaxError: Unexpected token ';'`.

**Fix:** all 9 occurrences were restored to `!!`, confirmed by context (every
site was a boolean coercion of an env var / pool / hub). The server now passes
`node --check`. A repo-wide scan confirmed the corruption was confined to this
one file. Logged as **BUG-K (critical)**.

This restoration was the top priority of V157 — nothing else matters if the
backend cannot boot.

---

## Deliverables (built on the now-bootable server)

### [V157-TASK-04] Admin WS connection hardening — `lib/adminWsHub.js`
- **Per-IP rate limit:** max 5 WebSocket connections per IP per 60s sliding
  window. Over-limit upgrades are rejected with `429 Too Many Requests`.
- **Idle reaper:** clients idle for more than 10 minutes are closed; a sweep
  runs every minute (handle `unref`'d). Activity timestamp refreshes on every
  message.
- New stats counters: `totalRejected`, `totalReaped`, `pressureThreshold`.

### [V157-TASK-10] System pressure alerts — `lib/adminWsHub.js`
- `buildPressureAlert(pressureRate)` (pure) returns a severity-graded alert
  (`elevated` > 30, `high` > 45, `critical` > 60) or null at/under threshold.
- `checkPressureAndAlert(metrics)` broadcasts `system.alert` to all admin
  clients when pressure exceeds 30%, debounced to at most one per 60s. Wired
  into the periodic metrics tick.

### [V157-TASK-05] Metrics persistence cron — `ecos-api-server.js`
- An env-gated `setInterval` snapshots AI metrics to `ai_metrics_snapshots`
  every 5 minutes when a DB pool is available, logging each run to
  `metrics_persistence_log (snapshot_count, duration_ms, error)`.
- Disable with `ECOS_METRICS_CRON=off`; interval overridable via
  `ECOS_METRICS_CRON_MS`. Non-fatal; handle `unref`'d.

### [V157-TASK-09] AI metrics CSV export — `ecos-api-server.js` + `lib/aiMetricsEngine.js`
- New `GET /api/v1/admin/ai-metrics/export?format=csv` streams the snapshot
  history as a downloadable CSV (`?format=json` also supported).
- New pure `metricsHistoryToCsv(rows)` helper with correct RFC-4180-style
  escaping (commas, quotes, newlines, nulls). Unit-tested.

---

## Tests

`tests/v157Hardening.test.js` (~23 tests, standalone-runnable): BUG-K
restoration (incl. a `vm.Script` parse check of the full server source), rate
limiter window/per-IP behaviour, idle reaper, pressure-alert severity, CSV
header/escaping, and endpoint/cron wiring markers, plus version/docs checks.

---

## New / modified files

| File | Change |
|------|--------|
| `ecos-api-server.js` | **BUG-K restore (9 sites)** + CSV export endpoint + metrics cron |
| `lib/adminWsHub.js` | rate limit + idle reaper + pressure alerts |
| `lib/aiMetricsEngine.js` | `metricsHistoryToCsv` pure helper + export |
| `tests/v157Hardening.test.js` | **NEW** — ~23 tests |
| `docs/CHANGELOG_V157.md`, `MIGRATION_NOTES_V157.md`, `NEXT_SESSION_PROMPT_V157.md` | **NEW** |
| `CLAUDE_CONTEXT.md` | STATE, BUG-K, version history | 
| `package.json` | 156.0.0 → 157.0.0 |

---

## Breaking changes
None. No schema changes (all tables used already exist in `migration_phase31.sql`).
New behaviour is additive or env-gated.

## Deferred to V158
Frontend tasks (V157-TASK-02 history chart, TASK-07 calibration tab,
TASK-08 workspace WS feed) and TASK-06 workspace task assignment API were
deferred — the critical server restore plus the backend observability/hardening
tasks were prioritised since a non-booting server blocked everything.

## Sacred Files — UNTOUCHED
- `lib/fiatLedger.js`  MD5: 563e9b1f9e67091a5b6527c0a92568e5 ✅
- `lib/auditLog.js`    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb ✅
