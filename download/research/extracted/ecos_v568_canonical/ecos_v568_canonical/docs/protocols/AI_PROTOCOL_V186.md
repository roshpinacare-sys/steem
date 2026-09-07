# AI_PROTOCOL_V186.md — ECOS V186 Operational Protocol

## Version
186.0.0 · Phase P75

## Purpose
Operational reference for AI assistants continuing ECOS development from V186.
Supplements `CLAUDE.md` (read that first).

---

## What changed in V186

| Tag | Component | Description |
|-----|-----------|-------------|
| V186-T01 | `GET /workspaces/:id/events/stats/diff` | Delta between two most-recent snapshots |
| V186-T02 | `POST /workspaces/:id/events/bookmarks/resolve-batch` | Batch bookmark-to-event resolution (≤20 names) |
| V186-T03 | `POST /api/v1/admin/tokens/expiry-query` | Bulk token expiry introspection (≤50 workspaceIds) |
| V186-T04 | `GET /admin/summary/v186` | Admin summary with V186 stats |

---

## New constants (V186)

| Constant | Value | Purpose |
|----------|-------|---------|
| `V186_BATCH_RESOLVE_MAX` | `20` | Max names per batch-resolve call |
| `V186_EXPIRY_QUERY_MAX`  | `50` | Max workspaceIds per expiry-query call |

---

## New functions (V186)

| Function | Description |
|----------|-------------|
| `_diffSnapshots186(prev186, curr186)` | Pure diff between two stats snapshot objects; returns `{ added, removed, changed }` |

---

## New endpoints (V186)

### GET /api/v1/workspaces/:workspaceId/events/stats/diff
- Reads `_statsSnapshots185` (V185).
- 404 `INSUFFICIENT_SNAPSHOTS_186` — fewer than 2 snapshots for this workspace.
- 200 `{ ok, workspaceId, prevSnapshot, currSnapshot, diff, ecosVersion }`.
- `diff` shape: `{ added, removed, changed }` — each is an object of `field → { prev, curr }`.
  - Fields compared: all keys of `typeCounts` plus scalars `totalEvents`, `firstAt`, `lastAt`.

### POST /api/v1/workspaces/:workspaceId/events/bookmarks/resolve-batch
- Body: `{ names: string[] }` (≤`V186_BATCH_RESOLVE_MAX` = 20).
- 400 `BATCH_RESOLVE_LIMIT_186` — array too large.
- Reads `_bookmarks184` (V184) and `_eventLog181` (V181).
- 200 `{ ok, workspaceId, results, total, resolved, ecosVersion }`.
- Each result: `{ name, found, bookmark?, event|null, code|null }`.
  - `code: 'BOOKMARK_NOT_FOUND_185'` — bookmark name absent.
  - `code: 'BOOKMARK_EVENT_NOT_IN_RING_185'` — messageId evicted from ring.
  - `code: null` — successfully resolved.

### POST /api/v1/admin/tokens/expiry-query
- Body: `{ workspaceIds: string[] }` (≤`V186_EXPIRY_QUERY_MAX` = 50).
- 400 `EXPIRY_QUERY_LIMIT_186` — array too large.
- Reuses `_tokenSvc181.hasToken` and `_tokenExpiry184` (same logic as V185-T03).
- 200 `{ ok, results, total, ecosVersion }`.
- Each result: `{ workspaceId, hasToken, expiresAt, remainingMs, expired }`.

### GET /api/v1/admin/summary/v186
- 200 with version `V186`, phase `P75`, feature list, config, and live stats.

---

## NODE_ENV=test exports added in V186

```
V186_BATCH_RESOLVE_MAX, V186_EXPIRY_QUERY_MAX, _diffSnapshots186
```

---

## Invariants status (post-V186)

| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (V178–V185) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |

---

## Common pitfalls (carry-forward from prior versions)

- **BUG-L** (duplicate const): suffix all new identifiers `_xxx186` / `186`.
- **BUG-K** (shell corruption): if `__manus_ec` / `trap '' PIPE` appears in source,
  replace entire artifact.
- **V185 snapshot chain**: `_statsSnapshot185` iterates `_eventLog181.keys()`.
  V187 snapshot extensions MUST call `_statsSnapshot185` or chain after it.
- **V184 token patch**: `_patchTokenPost184` is already applied; V187 MUST chain.
- **V183 events/log patch**: `_patchEventsLog183` is already applied; V187 MUST chain.
- **Broadcast wrapper**: triple-wrapped — chain onto current `_broadcast179.broadcast`.
- **Batch resolve reuse**: `_bookmarks184` and `_eventLog181` are the authoritative stores;
  V187 extensions MUST read from them, not introduce parallel stores.
- **Expiry query reuse**: `_tokenSvc181.hasToken` + `_tokenExpiry184` are authoritative;
  do not introduce parallel expiry maps.
