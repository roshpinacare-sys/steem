# Changelog — V179 (Phase P68)

**Release:** ECOS V179 · 2026-05-30 · stabilized canonical build

## Pre-flight stabilization (clean bill of health)
- `node --check ecos-api-server.js` → passes (no duplicate-const, no shell corruption).
- Sacred files verified unchanged (R1):
  - `lib/fiatLedger.js` MD5 `563e9b1f9e67091a5b6527c0a92568e5`
  - `lib/auditLog.js`   MD5 `e5a5c2c27801d2d03991bc8e5a1df8cb`
- V178 suite re-run green; no prior endpoints removed (R4).
- Note: an empty leftover `src/lib/` directory is present and unused (server
  requires only from `lib/`); harmless, left in place.

## Deliverable — Workspace Broadcast (`lib/workspaceBroadcastService.js`)
Per-workspace fan-out: register/unregister duck-typed clients (any object with a
`send()`), broadcast a message to all of them, and get a per-client delivery
result. Pure, zero-dependency (R6), fully unit-testable with mock clients.
Identifiers are V179-suffixed (`_broadcast179`, `WorkspaceBroadcastService179`,
`BroadcastValidationError179`) to avoid the duplicate-`const` failure class (R8).

- `POST /api/v1/workspaces/:workspaceId/broadcast`  `[V179-T01]`
- `GET  /api/v1/admin/summary/v179`                 `[V179-T04]`

Payload cap 64 KB; failing clients are isolated (one bad `send()` does not block
the rest); broadcasting to an empty workspace returns `delivered: 0` (not an error).

## Tests
`tests/v179.test.js` — 15 tests, all passing (registry, delivery, failure
isolation, validation, size cap, workspace isolation, stats + server-stability
parse guard + wiring + version/docs/sacred checks).

## Deferred (kept out to ship a stable build, per request)
- V179-T02 SSE event stream (`text/event-stream`) — needs live streaming; verify
  against a running server next session.
- V179-T03 bulk task status — a bulk task service already exists; reconcile before
  adding to avoid route/identifier duplication.

## Breaking changes
None. Additive only. All prior endpoints/tests preserved (R4, R5).
