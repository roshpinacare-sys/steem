# CHANGELOG_V183.md — ECOS V183 (Phase P72)

## Version: 183.0.0
## Phase: P72
## Date: 2026-05-30

---

## Summary

V183 completes Phase P72: optional `type` and `senderId` filtering on the
existing event log endpoint (GET `/workspaces/:id/events/log`), a new full-text
event search endpoint (`GET /workspaces/:id/events/search`), a bulk token clear
admin endpoint (`POST /admin/tokens/bulk-clear`, HTTP 207), and an admin
summary endpoint (`GET /admin/summary/v183`).

---

## New Features

### V183-T01 — Event Log Query Filtering
- **No new HTTP endpoint** — additive patch to V181's
  `GET /api/v1/workspaces/:workspaceId/events/log`.
- Adds optional query params `type` and `senderId` that, when present,
  filter the returned `events` array before the response is sent.
- When neither param is provided, behaviour is identical to V181 (no change,
  backwards-compatible).
- Implemented via runtime IIFE `_patchEventsLog183()` that wraps the existing
  Express route handler found in `app._router.stack` — no modification to V181
  source code (R4/R5-safe, fully additive).
- Filtered response adds `filteredBy: { type, senderId }` to the response body;
  `ecosVersion` becomes `'V183'` when any filter is applied.
- Idempotency guard (`_v183patched`) prevents double-wrapping on repeated module
  evaluation.

### V183-T02 — Workspace Event Log Search
- **Endpoint:** `GET /api/v1/workspaces/:workspaceId/events/search`
- Query params:
  - `q` (**required**) — search string; matched against JSON-stringified
    `payload` field of each event.
  - `limit` — page size (1–500, default 50).
  - `cursor` — `messageId` of last event on previous page (exclusive).
- Search is **case-sensitive** (substring match on `payload` as string).
- Order: newest-first (same as V181 log).
- Response schema matches `GET /events/log` shape with an additional top-level
  `q` field and `total` reflecting the matched count:
  ```json
  { "ok": true, "workspaceId": "...", "q": "...", "events": [...],
    "total": 3, "limit": 50, "cursor": null, "nextCursor": null,
    "ecosVersion": "V183" }
  ```
- Returns HTTP 400 when `q` is absent or empty.

### V183-T03 — Bulk Token Clear
- **Endpoint:** `POST /api/v1/admin/tokens/bulk-clear`
- Body: `{ "workspaceIds": ["ws-1", "ws-2", ...] }` (1 to 50 entries)
- Clears broadcast auth tokens for multiple workspaces in one request.
- Returns **HTTP 207** with per-workspace results:
  ```json
  { "ok": true, "results": [
      { "workspaceId": "ws-1", "cleared": true, "hadToken": true },
      { "workspaceId": "ws-2", "cleared": true, "hadToken": false }
    ],
    "cleared": 1, "skipped": 0, "ecosVersion": "V183" }
  ```
  - `cleared` (top-level) = count of workspaces that actually had a token removed.
  - `skipped` = count of entries with invalid workspaceId strings.
  - `hadToken` = whether the workspace had a token before the clear.
- Rejects arrays longer than `V183_BULK_CLEAR_MAX` (50) with HTTP 400
  and code `BULK_CLEAR_TOO_MANY_183`.

### V183-T04 — Admin Summary V183
- **Endpoint:** `GET /api/v1/admin/summary/v183`
- Returns version, phase `P72`, feature list, config (`bulkClearMax`),
  broadcast stats, token stats, persistence stats (from V182), and event log
  totals.

---

## Constants Added
| Constant | Value | Notes |
|---|---|---|
| `V183_BULK_CLEAR_MAX` | `50` | Max workspaceIds per bulk-clear request |

---

## Test Suite
- `tests/v183.test.js` — 43 tests, all pass.
- Covers: filtering logic (6), search logic (8), bulk-clear logic (6),
  server wiring source checks (12), NODE_ENV=test export (1),
  source integrity (10).
- Pattern follows v178–v182: reads server source as text (no server `require`)
  to avoid optional DB/rail module dependencies.

---

## Invariants Verified
- R1: `lib/fiatLedger.js` MD5 = `563e9b1f9e67091a5b6527c0a92568e5` ✓
- R1: `lib/auditLog.js`   MD5 = `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓
- R4: No endpoints removed ✓
- R5: v178/v179/v180/v181/v182 suites still green ✓
- R6: Zero new npm dependencies ✓
- R8: All new identifiers suffixed `_183` / `183`; exported under `NODE_ENV=test` ✓

---

## Files Changed
| File | Change |
|---|---|
| `ecos-api-server.js` | Appended V183 block (~140 lines) |
| `package.json` | version `183.0.0`, updated description |
| `tests/v183.test.js` | New — 43 tests |
| `CHANGELOG_V183.md` | New |
| `NEXT_SESSION_PROMPT_V183.md` | New |
| `AI_PROTOCOL_V183.md` | New |
| `CLAUDE.md` | Updated version/phase/state |
