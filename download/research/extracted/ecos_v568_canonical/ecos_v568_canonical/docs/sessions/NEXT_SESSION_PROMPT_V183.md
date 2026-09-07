# NEXT_SESSION_PROMPT_V183.md — Start of V184 (Phase P73)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v183_canonical.zip` (root `ecos_v183_canonical/`).
Read `CLAUDE.md` first.

## State at V183
- `ecos-api-server.js` parses clean; version 183.0.0; Phase P72 complete.
- New: Optional `type`/`senderId` filtering on `GET /events/log` via runtime
  router-stack patch `_patchEventsLog183` (V183-T01);
  full-text event search `GET /workspaces/:id/events/search` (V183-T02);
  bulk token clear `POST /admin/tokens/bulk-clear` (HTTP 207, V183-T03);
  admin summary V183 (V183-T04).
- Tests: `tests/v183.test.js` (43 tests). V178/V179/V180/V181/V182 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)

```bash
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v183.test.js    # must pass 43/43
NODE_ENV=test node tests/v182.test.js    # must pass 46/46
NODE_ENV=test node tests/v181.test.js    # must pass 38/38
NODE_ENV=test node tests/v180.test.js    # must pass 18/18
NODE_ENV=test node tests/v179.test.js    # must pass 15/15
NODE_ENV=test node tests/v178.test.js    # must pass 69/69 (0 failed)
md5sum lib/fiatLedger.js lib/auditLog.js
# Expected:
#   563e9b1f9e67091a5b6527c0a92568e5  lib/fiatLedger.js
#   e5a5c2c27801d2d03991bc8e5a1df8cb  lib/auditLog.js
```

- `Identifier '...' has already been declared` → duplicate require/const; suffix with
  `_xxx184` (BUG-L pattern from V169–V171).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace
  entire artifact with `!!` and re-check.

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## V183 NODE_ENV=test exports added
```
V183_BULK_CLEAR_MAX = 50
```

## Router-patch chain note for V184
- `_patchEventsLog183` wraps the V181 `GET /events/log` handler at runtime via
  `app._router.stack` traversal. The wrapped function is guarded with
  `_v183patched = true` to prevent double-wrapping.
- If V184 needs to further extend the `/events/log` handler, it MUST check for
  and chain onto the already-patched function (look for `_v183patched`), NOT
  re-patch `app._router.stack` from scratch.

## Broadcast wrapper chain note for V184
- `_broadcast179.broadcast` has been triple-wrapped:
  - V181: `_wrappedBroadcast181` (records into ring-buffer `_eventLog181`)
  - V182: `_wrappedBroadcast182` (calls `_persistSvc182.flush()` after each broadcast)
- Any V184 broadcast wrapper MUST chain onto the current `_broadcast179.broadcast`
  at that point in the code. Do NOT re-wrap originals — that would lose ring-buffer
  recording and/or persistence.

## Suggested P73 work (V184)

1. **V184-T01** — Event log statistics: `GET /workspaces/:id/events/stats`
   returning per-type event counts, first/last event timestamps, and top-senders
   (top 5 by event count) from the ring-buffer.

2. **V184-T02** — Event replay cursor bookmark: `POST /workspaces/:id/events/bookmark`
   storing a named cursor (name + messageId) per workspace in memory; `GET /workspaces/:id/events/bookmarks`
   lists all bookmarks; `DELETE /workspaces/:id/events/bookmarks/:name` removes one.

3. **V184-T03** — Token expiry: extend `POST /workspaces/:id/token` (V181-T03)
   with an optional `expiresAt` (ISO 8601) body field; auto-clear the token once
   the timestamp is reached (checked lazily on verify + a 1-min periodic sweep).

4. **V184-T04** — Admin summary V184.

## Packaging
`ecos_v184_canonical.zip`, root `ecos_v184_canonical/`. See CLAUDE.md for the Python script.
(Update the ZIP name and root folder name accordingly.)

## Judgment rule
When in doubt about schema / dependency / Sacred Files / system duplication — stop, choose
the safe option (additive, version-suffixed identifier), and report in the summary line.
A small stable ZIP beats a large broken one.
