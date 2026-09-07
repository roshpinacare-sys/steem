# NEXT_SESSION_PROMPT_V180.md — Start of V181 (Phase P70)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v180_canonical.zip` (root `ecos_v180_canonical/`).
Read `CLAUDE.md` first.

## State at V180
- `ecos-api-server.js` parses clean; version 180.0.0; Phase P69 complete.
- New: SSE event stream `GET /workspaces/:id/events/stream` (V180-T01) wired into
  `_broadcast179`; PATCH bulk-task-status ≤50 (V180-T02) thin layer on V170 service;
  admin summary V180 (V180-T04).
- Tests: `tests/v180.test.js` (18 tests). V178/V179 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)

```bash
node --check ecos-api-server.js        # must print nothing
NODE_ENV=test node tests/v180.test.js  # must pass all
NODE_ENV=test node tests/v179.test.js  # must pass 15/15
NODE_ENV=test node tests/v178.test.js  # must pass 69/69 (0 failed)
md5sum lib/fiatLedger.js lib/auditLog.js
# Expected:
#   563e9b1f9e67091a5b6527c0a92568e5  lib/fiatLedger.js
#   e5a5c2c27801d2d03991bc8e5a1df8cb  lib/auditLog.js
```

- `Identifier '...' has already been declared` → duplicate require/const; suffix with
  `_xxx181` (BUG-L pattern from V169–V171).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace
  entire artifact with `!!` and re-check.

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## V180 NODE_ENV=test exports added
```
_broadcast179_svc180   (alias for _broadcast179 under V180 label)
V180_BULK_MAX          = 50
V180_SSE_HEARTBEAT_MS  = 25000
```

## Suggested P70 work (V181)

1. **V181-T01** — Workspace event log: `GET /api/v1/workspaces/:id/events/log`
   Paginated log of all events broadcast to a workspace (last N, with cursor pagination).
   Wire into `_broadcast179` message history (add optional ring-buffer to
   `WorkspaceBroadcastService` — max 500 messages per workspace, configurable).

2. **V181-T02** — SSE stats endpoint: `GET /api/v1/workspaces/:id/events/stream/stats`
   Returns live subscriber count, total messages delivered, workspace broadcast stats.

3. **V181-T03** — Broadcast auth guard: add optional `X-Workspace-Token` header check
   on `POST /workspaces/:id/broadcast`. Token stored in-memory per workspace via a
   new `lib/workspaceTokenService181.js`.

4. **V181-T04** — Admin summary V181.

## Bulk-status notes for V181
- The existing V180-T02 PATCH route delegates to `_bulkStatus` (V170 `BulkTaskStatusService`).
- If per-task results need richer shape, extend the normalisation layer in the route handler
  rather than modifying the service (R4 additive rule).
- V180_BULK_MAX = 50; do not lower it in V181 without a migration note.

## Packaging
`ecos_v181_canonical.zip`, root `ecos_v181_canonical/`. See CLAUDE.md for the Python script.
(Update the ZIP name and root folder name accordingly.)

## Judgment rule
When in doubt about schema / dependency / Sacred Files / system duplication — stop, choose
the safe option (additive, version-suffixed identifier), and report in the summary line.
A small stable ZIP beats a large broken one.
