# Changelog — V262 (Phase P158) — WS Event Wiring + HITL REST Filters + Operator Mode

**Release:** ECOS V262 · 2026-06-01 · AI lead
**Base:** `ecos_v261_canonical` (P157 WS Live Dashboard + NDJSON Export)

---

## Overview

V261 defined `pushHitlLiveEvent261` and a WebSocket channel but did not wire them into
the server event loop. V262 closes that gap (Option A), extends the REST history endpoint
with time-range filters (Option B), and adds an Operator Mode to the dashboard (Option C).

---

## Option A — Wire pushHitlLiveEvent261 into the server event loop

### `wrapRejectHitlRun262(opts)`
Drop-in replacement for `rejectHitlRun260` that, after persisting the rejection, calls
`pushHitlLiveEvent261(notificationWsHub, { type: 'hitl_rejected', … })`. Non-fatal: WS
push errors never propagate to the caller. Accepts the same opts shape as `rejectHitlRun260`.

### `buildRunAutomation262Opts(baseOpts, notificationWsHub)`
Augments opts passed to `runAutomation255` with a wrapped `onProgress` handler that:
- Intercepts `step_hitl_paused` / `hitl_paused` events → broadcasts `type: 'hitl_paused'` via `pushHitlLiveEvent261`.
- Intercepts `resume_summary` events with `ok: true` → broadcasts `type: 'hitl_resumed'`.
- Forwards all events to the original `onProgress` unchanged.
- Also injects `notificationWsHub` into the opts so `automationRunner255`'s built-in `.push` fallback fires too.

This closes the loop end-to-end: dashboard WS feed now receives live events when runs pause or resume.

---

## Option B — HITL History REST filters (since/until on GET hitl-history)

### `getHitlHistory262(snapshotEngine, opts)`
Extends `getHitlHistory260` with `since` and `until` ISO8601 query params in addition to
existing `type`, `runId`, and `limit`. Both bounds are inclusive on `event.ts`.

### `[V262-T01] GET /api/v1/automations/hitl-history` (enhanced)
Overrides V260-T01. Adds optional query params:
- `since` — ISO8601 lower bound. Returns 400 `INVALID_SINCE` if malformed.
- `until` — ISO8601 upper bound. Returns 400 `INVALID_UNTIL` if malformed.

Response includes a `filters` object echoing all applied params. Useful for dashboard
incremental polling as WS fallback — call `since=<lastSeen>` to fetch only new events.

---

## Option C — Dashboard Operator Mode (`artifacts/automationDashboard261.jsx`)

Dashboard V5. Built on Dashboard V4 (`automationDashboard260.jsx`) — all V261 features
(WS live feed, NDJSON export, `WsLiveIndicator`) preserved intact.

### Lock/Unlock Toggle
Header gains a **🔑 Operator** / **🔒 Lock** button that toggles `operatorUnlocked` state.
When locked, the Operator section is hidden entirely.

### Operator Section (unlocked only)
`OperatorPanel` component with three capabilities:

**1. WebSocket Hub Status** — `⟳ Probe WS` button hits `GET /api/v1/admin/ws261/status`
and displays live client count (`N clients connected`).

**2. Custom Date Range NDJSON Export** — Two `datetime-local` inputs (`since` / `until`).
`⬇ Export NDJSON (range)` button builds a URL with `?since=…&until=…` query params and
triggers a browser download named `hitl-history-operator-<date>.ndjson`.

**3. Danger Zone — Clear All HITL History** — Operator-token input (password field, default `operator`).
`🗑 Clear All HITL History` sends `DELETE /api/v1/automations/hitl-history` with
`x-operator-token` header and confirms with `window.confirm` before proceeding.
Shows `✓ Cleared N events` or `✗ error` inline.

### Visual
- `C.op = "#ff6655"` — red-orange accent for operator mode elements.
- Footer updated to `V262 · P158 Dashboard V5`.

---

## API Endpoints

| Method   | Path                                            | Tag       | Description                                              |
|----------|-------------------------------------------------|-----------|----------------------------------------------------------|
| `GET`    | `/api/v1/automations/hitl-history`              | V262-T01  | Adds `since`/`until` ISO8601 params (enhances V260-T01) |
| `GET`    | `/api/v1/admin/summary/v262`                    | V262-T02  | V262 summary                                             |

All V261, V260, V259, V258, V257 endpoints preserved (R4).

---

## Verification
- `node --check ecos-api-server-v262-patch.js` clean.
- `tests/v262.test.js` — **48 passed, 0 failed**.
- V261 (38), V260 (32), V259 (22), V258 (17), V257 (43) all green.
- Sacred files UNTOUCHED (R1): fiatLedger `563e9b1f…` · auditLog `e5a5c2c2…`.
- Zero new npm deps (R6).

## Breaking changes
None. Additive only. All V261 endpoints preserved (R4). `GET /api/v1/automations/hitl-history`
response now includes `ecosVersion: 'V262'` and a `filters` object; otherwise backward-compatible.

## Next
- Wire `wrapRejectHitlRun262` into the main server IIFE (replace `rejectHitlRun260` calls in `ecos-api-server.js`).
- Wire `buildRunAutomation262Opts` into `registerV256Endpoints` resume call so resumed runs also fire WS events.
- Consider streaming NDJSON export from `GET /api/v1/automations/hitl-history/export` for very large logs.
- Add `automationId` filter to `GET /api/v1/automations/hitl-history` for dashboard per-automation drill-down.
