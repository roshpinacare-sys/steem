# NEXT_SESSION_PROMPT_V181.md — Start of V182 (Phase P71)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v181_canonical.zip` (root `ecos_v181_canonical/`).
Read `CLAUDE.md` first.

## State at V181
- `ecos-api-server.js` parses clean; version 181.0.0; Phase P70 complete.
- New: Workspace event log `GET /workspaces/:id/events/log` with cursor pagination
  and a 500-message ring-buffer per workspace (V181-T01); SSE subscriber stats
  `GET /workspaces/:id/events/stream/stats` (V181-T02); broadcast auth guard via
  `X-Workspace-Token` header + `lib/workspaceTokenService181.js` (V181-T03);
  admin summary V181 (V181-T04).
- Tests: `tests/v181.test.js` (38 tests). V178/V179/V180 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)

```bash
node --check ecos-api-server.js        # must print nothing
NODE_ENV=test node tests/v181.test.js  # must pass 38/38
NODE_ENV=test node tests/v180.test.js  # must pass 18/18
NODE_ENV=test node tests/v179.test.js  # must pass 15/15
NODE_ENV=test node tests/v178.test.js  # must pass 69/69 (0 failed)
md5sum lib/fiatLedger.js lib/auditLog.js
# Expected:
#   563e9b1f9e67091a5b6527c0a92568e5  lib/fiatLedger.js
#   e5a5c2c27801d2d03991bc8e5a1df8cb  lib/auditLog.js
```

- `Identifier '...' has already been declared` → duplicate require/const; suffix with
  `_xxx182` (BUG-L pattern from V169–V171).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace
  entire artifact with `!!` and re-check.

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## V181 NODE_ENV=test exports added
```
_tokenSvc181, WorkspaceTokenService181, TokenValidationError181, TokenAuthError181,
_eventLog181, _logEvent181,
V181_LOG_DEFAULT_LIMIT = 50, V181_LOG_MAX_LIMIT = 500, V181_RING_MAX = 500
```

## Suggested P71 work (V182)

1. **V182-T01** — Event log persistence: optional flush of `_eventLog181` ring-buffer
   to a JSON file on disk (configurable path via `ECOS_EVENT_LOG_PATH` env var).
   Load on startup; flush on every broadcast (async, non-blocking). Graceful fallback
   to in-memory-only when env var not set.

2. **V182-T02** — Token rotation: `PUT /api/v1/workspaces/:workspaceId/token`
   atomically replaces a token, returning `{ old: <masked>, new: <masked>, rotatedAt }`.
   Masking: show only first 4 + last 4 chars, rest as `***`.

3. **V182-T03** — Event log TTL pruning: configurable `V182_LOG_TTL_MS` (default 24 h).
   Add a `pruneOlderThan(workspaceId, cutoffMs)` method to the ring-buffer logic and
   a periodic sweep (every 5 min) via `setInterval`.

4. **V182-T04** — Admin summary V182.

## Ring-buffer notes for V182
- `V181_RING_MAX = 500` is the current cap. If V182 adds TTL pruning, the effective
  retained count may be lower but the hard cap must not be reduced below 500 without
  a migration note.
- The broadcast wrapper `_wrappedBroadcast181` reassigns `_broadcast179.broadcast` at
  module load time. If V182 adds another wrapper, chain it onto the already-wrapped
  function (do NOT re-wrap the original again; that would lose the V181 ring-buffer).

## Auth guard notes for V182
- The `app.use` middleware for broadcast auth (V181-T03) is registered AFTER the V179
  `app.post('/api/v1/workspaces/:workspaceId/broadcast', ...)` route.  In Express,
  `app.use` on a path runs BEFORE `app.post` for the same path only if registered first.
  The current implementation relies on the guard middleware short-circuiting with
  `res.status(403).json(...)` before calling `next()` on failure.  This works correctly
  because a 403 response stops routing.  V182 should preserve this behaviour.

## Packaging
`ecos_v182_canonical.zip`, root `ecos_v182_canonical/`. See CLAUDE.md for the Python script.
(Update the ZIP name and root folder name accordingly.)

## Judgment rule
When in doubt about schema / dependency / Sacred Files / system duplication — stop, choose
the safe option (additive, version-suffixed identifier), and report in the summary line.
A small stable ZIP beats a large broken one.
