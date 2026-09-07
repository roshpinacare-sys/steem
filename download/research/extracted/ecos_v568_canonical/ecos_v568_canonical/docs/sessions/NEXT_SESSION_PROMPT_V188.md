# NEXT_SESSION_PROMPT_V188.md — Start of V189 (Phase P78)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v188_canonical.zip` (root `ecos_v188_canonical/`).
Read `CLAUDE.md` first.

## State at V188
- `ecos-api-server.js` parses clean; version 188.0.0; Phase P77 complete.
- New: Snapshot export `GET /workspaces/:id/events/stats/snapshots/export` (V188-T01);
  bookmark bulk-delete `DELETE /workspaces/:id/events/bookmarks` (V188-T02);
  batch token clear v2 `POST /api/v1/admin/tokens/bulk-clear-v2` (V188-T03);
  admin summary V188 (V188-T04).
- Tests: `tests/v188.test.js` (72 tests). V178–V187 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)

```bash
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v188.test.js    # must pass all
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
  identifiers with `_xxx189` / `189` (BUG-L pattern).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace
  entire artifact and re-check.

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## V188 NODE_ENV=test exports added
```
V188_BOOKMARK_BULK_DELETE_MAX = 20
V188_BULK_CLEAR_V2_MAX = 50
```

## Chain notes for V189

### Snapshot export (V188-T01)
- `GET /workspaces/:id/events/stats/snapshots/export` reads `_statsSnapshots185` (no mutation).
- V189 snapshot extensions MUST use `_statsSnapshots185`; do not introduce a parallel store.

### Bookmark bulk-delete (V188-T02)
- `DELETE /workspaces/:id/events/bookmarks` mutates `_bookmarks184` in-place.
- V189 bookmark extensions MUST read/write `_bookmarks184`.

### Batch token clear v2 (V188-T03)
- `POST /admin/tokens/bulk-clear-v2` clears both `_tokenSvc181` and `_tokenExpiry184`.
- V189 bulk-token extensions MUST reuse both `_tokenSvc181` and `_tokenExpiry184`.

### Broadcast / patch chain notes (unchanged from V188)
- `_patchEventsLog183` wraps V181 `GET /events/log` — chain any V189 extension onto it.
- `_patchTokenPost184` wraps V181 `POST /token` — chain any V189 extension onto it.
- `_broadcast179.broadcast` is triple-wrapped (V181 → V182) — chain V189 onto current wrapper.

## Suggested P78 work (V189)
(To be determined by project maintainers.)

## Packaging
`ecos_v189_canonical.zip`, root `ecos_v189_canonical/`. See CLAUDE.md for the Python script.
(Update the ZIP name and root folder name accordingly.)

## Judgment rule
When in doubt about schema / dependency / Sacred Files / system duplication — stop, choose
the safe option (additive, version-suffixed identifier), and report in the summary line.
A small stable ZIP beats a large broken one.
