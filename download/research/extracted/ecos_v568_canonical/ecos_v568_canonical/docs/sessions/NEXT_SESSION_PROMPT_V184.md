# NEXT_SESSION_PROMPT_V184.md — Start of V185 (Phase P74)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v184_canonical.zip` (root `ecos_v184_canonical/`).
Read `CLAUDE.md` first.

## State at V184
- `ecos-api-server.js` parses clean; version 184.0.0; Phase P73 complete.
- New: Event log statistics `GET /workspaces/:id/events/stats` (V184-T01);
  cursor bookmark endpoints POST/GET/DELETE `/workspaces/:id/events/bookmark(s)` (V184-T02);
  token expiry via optional `expiresAt` on `POST /workspaces/:id/token` with
  lazy check + 1-min periodic sweep `_expirySweep184` (V184-T03);
  admin summary V184 (V184-T04).
- Tests: `tests/v184.test.js` (60 tests). V178/V179/V180/V181/V182/V183 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)

```bash
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v184.test.js    # must pass 60/60
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
  `_xxx185` (BUG-L pattern from V169–V171).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace
  entire artifact with `!!` and re-check.

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## V184 NODE_ENV=test exports added
```
V184_TOP_SENDERS_MAX = 5
V184_BOOKMARK_MAX = 100
V184_EXPIRY_SWEEP_MS = 60_000
_bookmarks184, _getBookmarkMap184
_tokenExpiry184, _checkTokenExpiry184, _expirySweep184, _expirySweepTimer184
_clearTokenWithExpiry184
```

## Token expiry patch chain note for V185
- `_patchTokenPost184` wraps the V181 `POST /workspaces/:id/token` handler at runtime
  via `app._router.stack` traversal, guarded by `_v184tokenPatched = true`.
- If V185 needs to further extend this endpoint, it MUST check for `_v184tokenPatched`
  and chain onto the already-patched function, NOT re-patch from scratch.

## Router-patch chain note for V185
- `_patchEventsLog183` wraps the V181 `GET /events/log` handler (guarded by `_v183patched`).
- Any V185 extension to `/events/log` MUST chain onto the `_v183patched` function.

## Broadcast wrapper chain note for V185
- `_broadcast179.broadcast` is triple-wrapped: V181 (_wrappedBroadcast181) → V182 (_wrappedBroadcast182).
- Any V185 broadcast wrapper MUST chain onto the current `_broadcast179.broadcast` at that
  point in the code. Do NOT re-wrap originals.

## Suggested P74 work (V185)

1. **V185-T01** — Bookmark-to-event resolution: `GET /workspaces/:id/events/bookmarks/:name/resolve`
   returning the event entry that matches the bookmark's `messageId` (or 404 if not in ring-buffer).

2. **V185-T02** — Stats snapshot history: store a rolling window of stats snapshots
   (e.g. last 10) per workspace via a scheduled `_statsSnapshot185` that fires every 5 min;
   expose via `GET /workspaces/:id/events/stats/history`.

3. **V185-T03** — Token expiry introspection: `GET /workspaces/:id/token/expiry`
   returning `{ workspaceId, hasToken, expiresAt, remainingMs, expired }`.

4. **V185-T04** — Admin summary V185.

## Packaging
`ecos_v185_canonical.zip`, root `ecos_v185_canonical/`. See CLAUDE.md for the Python script.
(Update the ZIP name and root folder name accordingly.)

## Judgment rule
When in doubt about schema / dependency / Sacred Files / system duplication — stop, choose
the safe option (additive, version-suffixed identifier), and report in the summary line.
A small stable ZIP beats a large broken one.
