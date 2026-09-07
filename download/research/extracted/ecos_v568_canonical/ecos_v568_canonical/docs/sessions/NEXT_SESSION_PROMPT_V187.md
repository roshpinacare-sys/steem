# NEXT_SESSION_PROMPT_V187.md — Start of V188 (Phase P77)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v187_canonical.zip` (root `ecos_v187_canonical/`).
Read `CLAUDE.md` first.

## State at V187
- `ecos-api-server.js` parses clean; version 187.0.0; Phase P76 complete.
- New: Snapshot window clear `DELETE /workspaces/:id/events/stats/snapshots` (V187-T01);
  bookmark rename `PATCH /workspaces/:id/events/bookmarks/:name` (V187-T02);
  batch token set `POST /api/v1/admin/tokens/bulk-set` (V187-T03);
  admin summary V187 (V187-T04).
- Tests: `tests/v187.test.js` (66 tests). V178–V186 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)

```bash
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v187.test.js    # must pass all
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
  identifiers with `_xxx188` / `188` (BUG-L pattern).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace
  entire artifact and re-check.

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## V187 NODE_ENV=test exports added
```
V187_BULK_SET_MAX = 50
```

## Chain notes for V188

### Snapshot clear (V187-T01)
- `DELETE /workspaces/:id/events/stats/snapshots` operates on `_statsSnapshots185`.
- Any V188 extension touching the snapshot store MUST call `_statsSnapshots185` directly;
  do not introduce a parallel map.

### Bookmark rename (V187-T02)
- `PATCH /workspaces/:id/events/bookmarks/:name` mutates `_bookmarks184` in-place.
- V188 bookmark extensions MUST read/write `_bookmarks184`; chain onto the existing map.

### Batch token set (V187-T03)
- `POST /admin/tokens/bulk-set` calls `_tokenSvc181.setToken` directly.
- V188 bulk-token extensions MUST reuse `_tokenSvc181`; do not introduce a parallel
  token store.

### Broadcast / patch chain notes (unchanged from V187)
- `_patchEventsLog183` wraps V181 `GET /events/log` — chain any V188 extension onto it.
- `_patchTokenPost184` wraps V181 `POST /token` — chain any V188 extension onto it.
- `_broadcast179.broadcast` is triple-wrapped (V181 → V182) — chain V188 onto current wrapper.

## Suggested P77 work (V188)

1. **V188-T01** — Snapshot export: `GET /workspaces/:id/events/stats/snapshots/export`
   Returns all snapshots in the rolling window as a JSON array (no deletion).
   Response: `{ ok, workspaceId, snapshots, total, ecosVersion }`.

2. **V188-T02** — Bookmark bulk delete: `DELETE /workspaces/:id/events/bookmarks`
   Accepts `{ names: string[] }` (≤20). Removes each named bookmark from `_bookmarks184`.
   HTTP 207; per-name result `{ name, deleted, code|null }`.

3. **V188-T03** — Batch token clear: `POST /api/v1/admin/tokens/bulk-clear-v2`
   Extends V183-T03 bulk-clear to also remove entries from `_tokenExpiry184`.
   Accepts `{ workspaceIds: string[] }` (≤50). HTTP 207.

4. **V188-T04** — Admin summary V188.

## Packaging
`ecos_v188_canonical.zip`, root `ecos_v188_canonical/`. See CLAUDE.md for the Python script.
(Update the ZIP name and root folder name accordingly.)

## Judgment rule
When in doubt about schema / dependency / Sacred Files / system duplication — stop, choose
the safe option (additive, version-suffixed identifier), and report in the summary line.
A small stable ZIP beats a large broken one.
