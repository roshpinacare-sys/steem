# NEXT_SESSION_PROMPT_V186.md — Start of V187 (Phase P76)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v186_canonical.zip` (root `ecos_v186_canonical/`).
Read `CLAUDE.md` first.

## State at V186
- `ecos-api-server.js` parses clean; version 186.0.0; Phase P75 complete.
- New: Stats snapshot diff `GET /workspaces/:id/events/stats/diff` (V186-T01);
  bookmark batch resolve `POST /workspaces/:id/events/bookmarks/resolve-batch` (V186-T02);
  token expiry bulk query `POST /api/v1/admin/tokens/expiry-query` (V186-T03);
  admin summary V186 (V186-T04).
- Tests: `tests/v186.test.js` (≥70 tests). V178–V185 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)

```bash
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v186.test.js    # must pass all
NODE_ENV=test node tests/v185.test.js    # must pass 62/62
NODE_ENV=test node tests/v184.test.js    # must pass 60/60
NODE_ENV=test node tests/v183.test.js    # must pass 43/43
NODE_ENV=test node tests/v182.test.js    # must pass 46/46
NODE_ENV=test node tests/v181.test.js    # must pass 38/38
NODE_ENV=test node tests/v180.test.js    # must pass 18/18
NODE_ENV=test node tests/v179.test.js    # must pass 15/15
NODE_ENV=test node tests/v178.test.js    # must pass 69/69
md5sum lib/fiatLedger.js lib/auditLog.js
# Expected:
#   563e9b1f9e67091a5b6527c0a92568e5  lib/fiatLedger.js
#   e5a5c2c27801d2d03991bc8e5a1df8cb  lib/auditLog.js
```

- `Identifier '...' has already been declared` → duplicate require/const; suffix with
  `_xxx187` (BUG-L pattern from V169–V171).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace
  entire artifact with `!!` and re-check.

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## V186 NODE_ENV=test exports added
```
V186_BATCH_RESOLVE_MAX = 20
V186_EXPIRY_QUERY_MAX  = 50
_diffSnapshots186
```

## Diff helper chain note for V187
- `_diffSnapshots186(prev, curr)` is a pure function comparing two stats snapshot objects.
- V187 diff extensions (e.g. comparing topSenders) MUST either extend `_diffSnapshots186`
  or call it as part of a new wrapper — do NOT re-implement field iteration.

## Batch resolve chain note for V187
- `POST /workspaces/:id/events/bookmarks/resolve-batch` reads `_bookmarks184` and `_eventLog181`.
  Any V187 extension (e.g. resolve-batch with metadata) MUST reuse these same stores.

## Token expiry chain note for V187
- `POST /admin/tokens/expiry-query` reads `_tokenSvc181.hasToken` and `_tokenExpiry184`.
  Any V187 bulk extension MUST reuse these stores, not introduce parallel expiry maps.

## Broadcast / patch chain notes (unchanged from V186)
- `_patchEventsLog183` wraps V181 `GET /events/log` — chain any V187 extension onto it.
- `_patchTokenPost184` wraps V181 `POST /token` — chain any V187 extension onto it.
- `_broadcast179.broadcast` is triple-wrapped (V181 → V182) — chain V187 onto current wrapper.

## Suggested P76 work (V187)

1. **V187-T01** — Snapshot window clear: `DELETE /workspaces/:id/events/stats/snapshots`
   Clears the rolling window for a workspace (useful for testing / reset).
   Returns `{ ok, workspaceId, cleared, ecosVersion }`.

2. **V187-T02** — Bookmark rename: `PATCH /workspaces/:id/events/bookmarks/:name`
   Accepts `{ newName: string }`. Renames an existing bookmark in `_bookmarks184`.
   400 if `newName` already taken; 404 if `name` not found.

3. **V187-T03** — Batch token set: `POST /api/v1/admin/tokens/bulk-set`
   Accepts `{ tokens: Array<{workspaceId, token}> }` (≤50).
   Sets tokens in bulk via `_tokenSvc181.setToken`. HTTP 207.

4. **V187-T04** — Admin summary V187.

## Packaging
`ecos_v187_canonical.zip`, root `ecos_v187_canonical/`. See CLAUDE.md for the Python script.
(Update the ZIP name and root folder name accordingly.)

## Judgment rule
When in doubt about schema / dependency / Sacred Files / system duplication — stop, choose
the safe option (additive, version-suffixed identifier), and report in the summary line.
A small stable ZIP beats a large broken one.
