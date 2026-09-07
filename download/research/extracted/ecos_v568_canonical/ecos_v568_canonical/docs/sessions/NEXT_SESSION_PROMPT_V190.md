# NEXT_SESSION_PROMPT_V190.md — Start of V191 (Phase P80)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v190_canonical.zip` (root `ecos_v190_canonical/`).
Read `CLAUDE.md` first.

## State at V190
- `ecos-api-server.js` parses clean; version 190.0.0; Phase P79 complete.
- New: Snapshot trim `POST /workspaces/:id/events/stats/snapshots/trim` (V190-T01);
  bookmark get `GET /workspaces/:id/events/bookmarks/:name` (V190-T02);
  bulk token rotate `POST /api/v1/admin/tokens/bulk-rotate` (V190-T03);
  admin summary V190 (V190-T04).
- Tests: `tests/v190.test.js`. V178–V189 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)

```bash
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v190.test.js    # must pass all
NODE_ENV=test node tests/v189.test.js    # must pass 59/59
NODE_ENV=test node tests/v188.test.js    # must pass 72/72
NODE_ENV=test node tests/v187.test.js    # must pass 66/66
NODE_ENV=test node tests/v186.test.js    # must pass 77/77
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

- `Identifier '...' has already been declared` → duplicate require/const; suffix all new
  identifiers with `_xxx191` / `191` (BUG-L pattern).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace
  entire artifact and re-check.

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## V190 NODE_ENV=test exports added
```
V190_SNAPSHOT_TRIM_MAX = 10
V190_BULK_ROTATE_MAX   = 50
```

## Chain notes for V191

### Snapshot trim (V190-T01)
- `POST /workspaces/:id/events/stats/snapshots/trim` mutates `_statsSnapshots185`.
- V191 snapshot extensions MUST use `_statsSnapshots185`; do not introduce a parallel store.

### Bookmark get (V190-T02)
- `GET /workspaces/:id/events/bookmarks/:name` reads `_bookmarks184` (no mutation).
- V191 bookmark extensions MUST read/write `_bookmarks184`.

### Bulk token rotate (V190-T03)
- `POST /admin/tokens/bulk-rotate` uses `_tokenSvc181.setToken` and `_tokenSvc181.hasToken`.
- V191 token extensions MUST reuse `_tokenSvc181` and `_tokenExpiry184`.

### Broadcast / patch chain notes (unchanged from V190)
- `_patchEventsLog183` wraps V181 `GET /events/log` — chain any V191 extension onto it.
- `_patchTokenPost184` wraps V181 `POST /token` — chain any V191 extension onto it.
- `_broadcast179.broadcast` is triple-wrapped (V181 → V182) — chain V191 onto current wrapper.

## Suggested P80 work (V191)
(To be determined by project maintainers.)

## Packaging
`ecos_v191_canonical.zip`, root `ecos_v191_canonical/`. See CLAUDE.md for the Python script.
(Update the ZIP name and root folder name accordingly.)

## Judgment rule
When in doubt about schema / dependency / Sacred Files / system duplication — stop, choose
the safe option (additive, version-suffixed identifier), and report in the summary line.
A small stable ZIP beats a large broken one.
