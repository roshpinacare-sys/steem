# NEXT_SESSION_PROMPT_V185.md — Start of V186 (Phase P75)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v185_canonical.zip` (root `ecos_v185_canonical/`).
Read `CLAUDE.md` first.

## State at V185
- `ecos-api-server.js` parses clean; version 185.0.0; Phase P74 complete.
- New: Bookmark-to-event resolution `GET /workspaces/:id/events/bookmarks/:name/resolve` (V185-T01);
  stats snapshot history `_statsSnapshot185` + `GET /workspaces/:id/events/stats/history` (V185-T02);
  token expiry introspection `GET /workspaces/:id/token/expiry` (V185-T03);
  admin summary V185 (V185-T04).
- Tests: `tests/v185.test.js` (62 tests). V178/V179/V180/V181/V182/V183/V184 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)

```bash
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v185.test.js    # must pass 62/62
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
  `_xxx186` (BUG-L pattern from V169–V171).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace
  entire artifact with `!!` and re-check.

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## V185 NODE_ENV=test exports added
```
V185_SNAPSHOT_MAX = 10
V185_SNAPSHOT_INTERVAL_MS = 300_000
_statsSnapshots185, _statsSnapshot185, _pushSnapshot185
_computeStats185, _statsSnapshotTimer185
```

## Stats snapshot chain note for V186
- `_statsSnapshot185` is a scheduled function iterating `_eventLog181.keys()`.
- If V186 needs to extend snapshot capture (e.g. per-type snapshots), it MUST
  call `_statsSnapshot185` or chain after it — do NOT re-implement iteration.

## Token expiry chain note for V186
- `GET /workspaces/:id/token/expiry` reads `_tokenSvc181.hasToken` and `_tokenExpiry184`.
  Any V186 extension (e.g. bulk expiry query) MUST reuse these stores, not introduce
  parallel expiry maps.

## Router-patch chain note for V186
- `_patchEventsLog183` wraps the V181 `GET /events/log` handler (guarded by `_v183patched`).
- Any V186 extension to `/events/log` MUST chain onto the `_v183patched` function.

## Broadcast wrapper chain note for V186
- `_broadcast179.broadcast` is triple-wrapped: V181 (_wrappedBroadcast181) → V182 (_wrappedBroadcast182).
- Any V186 broadcast wrapper MUST chain onto the current `_broadcast179.broadcast` at that
  point in the code. Do NOT re-wrap originals.

## Suggested P75 work (V186)

1. **V186-T01** — Snapshot diff: `GET /workspaces/:id/events/stats/diff`
   returning the delta between the two most-recent snapshots
   (`{ added, removed, changed }` per field).

2. **V186-T02** — Bookmark batch resolve: `POST /workspaces/:id/events/bookmarks/resolve-batch`
   accepting `{ names: string[] }` (≤20) and returning an array of per-name
   `{ name, found, event | null, code | null }` results in a single request.

3. **V186-T03** — Token expiry bulk query: `POST /api/v1/admin/tokens/expiry-query`
   accepting `{ workspaceIds: string[] }` (≤50) and returning an array of
   per-workspace expiry introspection objects (reusing V185-T03 logic).

4. **V186-T04** — Admin summary V186.

## Packaging
`ecos_v186_canonical.zip`, root `ecos_v186_canonical/`. See CLAUDE.md for the Python script.
(Update the ZIP name and root folder name accordingly.)

## Judgment rule
When in doubt about schema / dependency / Sacred Files / system duplication — stop, choose
the safe option (additive, version-suffixed identifier), and report in the summary line.
A small stable ZIP beats a large broken one.
