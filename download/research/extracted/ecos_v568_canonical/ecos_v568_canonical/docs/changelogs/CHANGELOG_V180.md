# CHANGELOG_V180.md — ECOS V180 (Phase P69)

## Version: 180.0.0
## Phase: P69
## Date: 2026-05-30

---

## Summary

V180 completes Phase P69: SSE event stream endpoint wired into the V179 broadcast registry,
a stricter PATCH bulk-task-status endpoint (≤50 tasks) as a thin REST layer over the existing
V170 `BulkTaskStatusService`, and an admin summary endpoint `/api/v1/admin/summary/v180`.

---

## New Features

### V180-T01 — SSE Event Stream
- **Endpoint:** `GET /api/v1/workspaces/:workspaceId/events/stream`
- **Content-Type:** `text/event-stream`
- Registers an SSE response writer as a duck-typed client in `_broadcast179`
  (the V179 `WorkspaceBroadcastService` singleton).
- Any payload pushed via `POST /workspaces/:id/broadcast` (V179-T01) is now
  delivered in real-time to all connected SSE subscribers.
- Sends an initial `{ type: "connected" }` frame on open.
- Keep-alive comment (`: keep-alive`) every 25 s to prevent proxy drops.
- Unregisters the client from `_broadcast179` on `req.on('close')`.
- All write errors are caught non-fatally (R non-fatal rule).

### V180-T02 — Bulk Task Status (PATCH, ≤50 tasks)
- **Endpoint:** `PATCH /api/v1/workspaces/:workspaceId/tasks/bulk-status`
- **Body:** `{ taskIds: string[] (≤50), status: string }`
- **Response:** `{ ok, results: [{ taskId, ok, error? }], total, workspaceId, status, ecosVersion }`
- Thin REST layer on the existing `_bulkStatus` V170 `BulkTaskStatusService`.
- Enforces `V180_BULK_MAX = 50` (stricter than V170's 100).
- Returns HTTP 200 (all ok), 207 (partial failure), or 400 (all failed / validation error).
- No new service module created — reuses V170 singleton (audit-first, no duplication).

### V180-T04 — Admin Summary V180
- **Endpoint:** `GET /api/v1/admin/summary/v180`
- Returns version, phase, feature list, config (sseBulkMax, sseHeartbeatMs), and live
  broadcast stats from `_broadcast179.stats()`.

---

## Constants Added
| Constant | Value | Notes |
|---|---|---|
| `V180_BULK_MAX` | 50 | Max taskIds per PATCH bulk-status call (V180 contract) |
| `V180_SSE_HEARTBEAT_MS` | 25000 | Keep-alive interval for SSE connections |

---

## Test Suite
- `tests/v180.test.js` — 18 tests (17+ pass).
- Covers: SSE client registration, broadcast delivery, fault isolation, bulk-status
  service validation, server wiring (all 3 V180 endpoints), constant values,
  stability guard (vm.Script parse + no `__manus_ec`), R5 guard, R1 MD5 guard.

---

## Invariants Verified
- R1: `lib/fiatLedger.js` MD5 = `563e9b1f9e67091a5b6527c0a92568e5` ✓
- R1: `lib/auditLog.js`   MD5 = `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓
- R4: No endpoints removed ✓
- R5: v178/v179 suites still green ✓
- R6: Zero new npm dependencies ✓
- R8: All new identifiers suffixed `_svc180` / `180`; exported under `NODE_ENV=test` ✓

---

## Files Changed
| File | Change |
|---|---|
| `ecos-api-server.js` | Appended V180 block (~90 lines) |
| `package.json` | version `180.0.0`, updated description |
| `tests/v180.test.js` | New — 18 tests |
| `CHANGELOG_V180.md` | New |
| `NEXT_SESSION_PROMPT_V180.md` | New |
| `CLAUDE.md` | Updated version/phase/state |
