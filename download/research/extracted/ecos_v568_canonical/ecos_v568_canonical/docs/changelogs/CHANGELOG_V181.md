# CHANGELOG_V181.md — ECOS V181 (Phase P70)

## Version: 181.0.0
## Phase: P70
## Date: 2026-05-30

---

## Summary

V181 completes Phase P70: a ring-buffer-backed workspace event log endpoint,
a live SSE subscriber-count stats endpoint, a broadcast auth guard (optional
`X-Workspace-Token` header enforcement per workspace via a new
`lib/workspaceTokenService181.js`), and an admin summary endpoint
`/api/v1/admin/summary/v181`.

---

## New Features

### V181-T01 — Workspace Event Log
- **Endpoint:** `GET /api/v1/workspaces/:workspaceId/events/log`
- Cursor-paginated log of all events broadcast to a workspace (newest-first).
- Query params: `limit` (1–500, default 50), `cursor` (messageId, exclusive).
- Backed by an in-memory ring-buffer (`_eventLog181`) capped at **500 messages**
  per workspace (`V181_RING_MAX = 500`).
- Ring-buffer is populated by wrapping `_broadcast179.broadcast` with a thin,
  non-destructive interceptor (`_wrappedBroadcast181`) — no service file modified.
- Response: `{ ok, workspaceId, events, total, limit, cursor, nextCursor, ecosVersion }`.

### V181-T02 — SSE Stream Stats
- **Endpoint:** `GET /api/v1/workspaces/:workspaceId/events/stream/stats`
- Returns: live subscriber count, subscriber IDs, logged event count,
  ring-buffer max, and global broadcast stats from `_broadcast179.stats()`.
- Response: `{ ok, workspaceId, subscriberCount, subscriberIds, loggedEventCount,
  ringBufferMax, globalBroadcast, ecosVersion }`.

### V181-T03 — Broadcast Auth Guard
- **New lib:** `lib/workspaceTokenService181.js`
  - `WorkspaceTokenService181` — in-memory per-workspace token store.
  - `setToken(workspaceId, token)` — stores token (≤ 256 chars).
  - `clearToken(workspaceId)` — removes token (workspace becomes open).
  - `verify(workspaceId, provided)` — timing-safe comparison via
    `crypto.timingSafeEqual`; throws `TokenAuthError181` (HTTP 403) on mismatch.
  - `hasToken`, `stats()`, `shutdown()` (test teardown).
- **Token management endpoints:**
  - `POST /api/v1/workspaces/:workspaceId/token` — set or replace token.
  - `DELETE /api/v1/workspaces/:workspaceId/token` — clear token.
- **Auth guard:** `app.use` middleware on `/api/v1/workspaces/:workspaceId/broadcast`
  checks `X-Workspace-Token` header before the V179 route handler runs.
  Workspaces without a configured token remain open (backwards-compatible).

### V181-T04 — Admin Summary V181
- **Endpoint:** `GET /api/v1/admin/summary/v181`
- Returns version, phase, feature list, config (logDefaultLimit, logMaxLimit,
  ringBufferMax), broadcast stats, token stats, and event log totals.

---

## Constants Added
| Constant | Value | Notes |
|---|---|---|
| `V181_LOG_DEFAULT_LIMIT` | 50 | Default page size for event log |
| `V181_LOG_MAX_LIMIT` | 500 | Absolute cap on page size |
| `V181_RING_MAX` | 500 | Max messages kept per workspace ring-buffer |

---

## Test Suite
- `tests/v181.test.js` — 38 tests, all pass.
- Covers: TokenService unit tests (14), ring-buffer logic (4), server wiring (8),
  NODE_ENV=test export presence (5), source integrity (7).
- Pattern follows v178/v179/v180: reads server source as text (no server `require`)
  to avoid optional DB/rail module dependencies.

---

## Invariants Verified
- R1: `lib/fiatLedger.js` MD5 = `563e9b1f9e67091a5b6527c0a92568e5` ✓
- R1: `lib/auditLog.js`   MD5 = `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓
- R4: No endpoints removed ✓
- R5: v178/v179/v180 suites still green ✓
- R6: Zero new npm dependencies ✓
- R8: All new identifiers suffixed `_181` / `181`; exported under `NODE_ENV=test` ✓

---

## Files Changed
| File | Change |
|---|---|
| `ecos-api-server.js` | Appended V181 block (~170 lines) |
| `lib/workspaceTokenService181.js` | New — in-memory broadcast auth token service |
| `package.json` | version `181.0.0`, updated description |
| `tests/v181.test.js` | New — 38 tests |
| `CHANGELOG_V181.md` | New |
| `NEXT_SESSION_PROMPT_V181.md` | New |
| `CLAUDE.md` | Updated version/phase/state |
