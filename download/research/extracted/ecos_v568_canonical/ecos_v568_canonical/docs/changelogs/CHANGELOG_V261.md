# Changelog — V261 (Phase P157) — WebSocket Live Dashboard + HITL History Export

**Release:** ECOS V261 · 2026-06-01 · AI lead
**Base:** `ecos_v260_canonical` (P156 HITL Persistence via snapshotEngine.setExtra)

---

## Overview

V260 delivered persisted HITL history. V261 makes it **real-time and auditable**:

- **P157-A** — WebSocket live event feed: `hitl_paused` / `hitl_rejected` / `hitl_resumed` pushed
  instantly to the dashboard without polling. Dashboard V4 (`automationDashboard260.jsx`) opens
  a WS connection on mount and dispatches received events directly into local state.
- **P157-C** — HITL History Export: `GET /api/v1/automations/hitl-history/export` streams the
  full persisted log as NDJSON with `since` / `until` ISO8601 filters for offline analysis and
  audit compliance. `DELETE /api/v1/automations/hitl-history` (operator-only) clears the log.

---

## Feature — `ecos-api-server-v261-patch.js`

### WS Live Helpers (P157-A)

#### `pushHitlLiveEvent261(notificationWsHub, event)`
Broadcasts a HITL event to all connected WebSocket clients. Prefers `hub.broadcast()` (fan-out),
falls back to `hub.push('__broadcast__', ...)`. Non-fatal: returns `false` when hub is unavailable.

#### `subscribeHitlLive261(notificationWsHub, { onEvent })`
Registers a listener via `hub.on('message', ...)` filtered to `channel === 'hitl_live261'`.
Returns `{ unsubscribe }` for cleanup. Gracefully degrades when hub has no `.on`.

#### `getWsStatus261(notificationWsHub)`
Probes hub capability: `available`, `hasBroadcast`, `hasOn`, `hasPush`, `clientCount`.

### Export / Clear (P157-C)

#### `exportHitlHistoryNdjson261(snapshotEngine, opts)`
Returns `{ lines, count, truncated }` where each line is a `JSON.stringify`-ed event record
enriched with `exportedAt261`. Filters: `since` (ISO8601), `until` (ISO8601), `type`.
Capped at `HITL_EXPORT_MAX_261 = 100_000`.

#### `clearHitlHistory261(snapshotEngine)`
Operator-only clear: writes `[]` back to `snapshotEngine.setExtra(HITL_HISTORY_KEY_260, [])`.
Returns `{ cleared, previousCount }`.

## API Endpoints

| Method   | Path                                            | Tag       | Description                                      |
|----------|-------------------------------------------------|-----------|--------------------------------------------------|
| `GET`    | `/api/v1/automations/hitl-history/export`       | V261-T01  | NDJSON export; `?since=` `?until=` `?type=`     |
| `DELETE` | `/api/v1/automations/hitl-history`              | V261-T02  | Clear persisted log (operator-only)              |
| `GET`    | `/api/v1/admin/ws261/status`                    | V261-T03  | WS hub capability probe                          |
| `GET`    | `/api/v1/admin/summary/v261`                    | V261-T04  | V261 summary                                     |

---

## Feature — `artifacts/automationDashboard260.jsx` (Dashboard V4)

### WebSocket Live Connection
- Opens `ws://<baseUrl>/api/v1/ws` on mount via `connectWs261()`.
- On open: sends `{ type: "subscribe", channel: "hitl_live261" }`.
- On message: parses `hitl_paused` / `hitl_rejected` / `hitl_resumed` events and injects them
  directly into `hitlHistory` state (with `_liveReceived: true` badge) and `hitlQueue` state
  — **no polling round-trip required**.
- WS state machine: `connecting → open / error / closed`. Auto-reconnects after 5 s on close.
- Falls back to 30 s polling when WS is in `error` or `closed` state.
- `WsLiveIndicator` component shows `LIVE` (pulsing pink dot), `CONNECTING…`, `WS ERR`, or `POLL`.

### NDJSON Export
- `⬇ Export NDJSON` button in the HITL History panel triggers a browser download of
  `/api/v1/automations/hitl-history/export` as a dated `.ndjson` file.

### Visual Additions
- `C.live = "#ff88cc"` — pink accent for live event indicators.
- `LIVE` pill on history entries received via WebSocket.
- `WsLiveIndicator` in header and HITL Queue section header.
- CSS keyframe `pulse261` injected once via `useEffect`.

---

## Verification
- `node --check ecos-api-server-v261-patch.js` clean.
- `tests/v261.test.js` — **38 passed, 0 failed**.
- V260 (tests/v260.test.js), V259, V258, V257 all still green.
- Sacred files UNTOUCHED (R1): fiatLedger `563e9b1f…` · auditLog `e5a5c2c2…`.
- Zero new npm deps (R6).

## Breaking changes
None. Additive only. All V260 endpoints preserved (R4).

## Next
- Connect `pushHitlLiveEvent261` into `rejectHitlRun260` and `automationRunner255` so the
  server actually fires WS events when runs pause/reject.
- Add `since`/`until` query params to `GET /api/v1/automations/hitl-history` (REST, not export).
- Dashboard: add `DELETE` button (operator mode) to clear history from the UI.
