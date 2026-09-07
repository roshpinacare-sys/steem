# NEXT_SESSION_PROMPT_V182.md — Start of V183 (Phase P72)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v182_canonical.zip` (root `ecos_v182_canonical/`).
Read `CLAUDE.md` first.

## State at V182
- `ecos-api-server.js` parses clean; version 182.0.0; Phase P71 complete.
- New: Event log persistence to disk via `ECOS_EVENT_LOG_PATH` (V182-T01);
  token rotation `PUT /workspaces/:id/token` with masked old/new return (V182-T02);
  TTL pruning `_pruneOlderThan182` + 5-min periodic sweep `_ttlSweepTimer182`
  (`V182_LOG_TTL_MS` = 24 h, V182-T03); admin summary V182 (V182-T04).
- Tests: `tests/v182.test.js` (46 tests). V178/V179/V180/V181 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)

```bash
node --check ecos-api-server.js        # must print nothing
NODE_ENV=test node tests/v182.test.js  # must pass 46/46
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
  `_xxx183` (BUG-L pattern from V169–V171).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace
  entire artifact with `!!` and re-check.

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## V182 NODE_ENV=test exports added
```
_persistSvc182, EventPersistenceService182,
_pruneOlderThan182, _ttlSweep182, _maskToken182,
_ttlSweepTimer182,
V182_LOG_TTL_MS = 86400000, V182_PRUNE_INTERVAL = 300000
```

## Broadcast wrapper chain note for V183
- `_broadcast179.broadcast` has been double-wrapped:
  - V181: `_wrappedBroadcast181` (records into ring-buffer `_eventLog181`)
  - V182: `_wrappedBroadcast182` (calls `_persistSvc182.flush()` after each broadcast)
- If V183 adds another broadcast wrapper, chain it onto the V182-wrapped function
  (bind `_broadcast179.broadcast` at that point). Do NOT re-wrap the original or
  the V181 wrapper — that would lose ring-buffer recording and/or persistence.

## TTL pruning notes for V183
- `_ttlSweepTimer182` is unref()'d. A future version may want to make the TTL
  configurable at runtime (e.g. via a PATCH endpoint), but the constant
  `V182_LOG_TTL_MS` must remain the authoritative default.
- `_pruneOlderThan182` is exported under `NODE_ENV=test` and can be called
  directly in tests to simulate TTL expiry without waiting for the sweep.

## Suggested P72 work (V183)

1. **V183-T01** — Event log query filtering: add optional `type` and `senderId`
   query params to `GET /workspaces/:id/events/log` to filter by event type or
   sender without changing the existing response schema.

2. **V183-T02** — Workspace event log search: `GET /workspaces/:id/events/search`
   with a `q` full-text query param (searches `payload` field as JSON string),
   returning matching events newest-first with the same pagination shape as T01.

3. **V183-T03** — Bulk token operations: `POST /api/v1/admin/tokens/bulk-clear`
   accepting `{ workspaceIds: string[] }` (≤50) that clears tokens for multiple
   workspaces in a single request, returning per-workspace results (HTTP 207).

4. **V183-T04** — Admin summary V183.

## Packaging
`ecos_v183_canonical.zip`, root `ecos_v183_canonical/`. See CLAUDE.md for the Python script.
(Update the ZIP name and root folder name accordingly.)

## Judgment rule
When in doubt about schema / dependency / Sacred Files / system duplication — stop, choose
the safe option (additive, version-suffixed identifier), and report in the summary line.
A small stable ZIP beats a large broken one.
