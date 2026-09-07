# AI_PROTOCOL_V187.md — ECOS V187 Operational Protocol

## Version
187.0.0 · Phase P76

## Purpose
Operational reference for AI assistants continuing ECOS development from V187.
Supplements `CLAUDE.md` (read that first).

---

## What changed in V187

| Tag | Component | Description |
|-----|-----------|-------------|
| V187-T01 | `DELETE /workspaces/:id/events/stats/snapshots` | Clear rolling snapshot window for a workspace |
| V187-T02 | `PATCH /workspaces/:id/events/bookmarks/:name` | Rename a bookmark (accepts `{ newName }`) |
| V187-T03 | `POST /api/v1/admin/tokens/bulk-set` | Set tokens in bulk (≤50, HTTP 207) |
| V187-T04 | `GET /admin/summary/v187` | Admin summary with V187 stats |

---

## New constants (V187)

| Constant | Value | Purpose |
|----------|-------|---------|
| `V187_BULK_SET_MAX` | `50` | Max entries per bulk-set call |

---

## New error codes (V187)

| Code | HTTP | Endpoint | Meaning |
|------|------|----------|---------|
| `BOOKMARK_NOT_FOUND_187` | 404 | PATCH bookmark | Named bookmark absent |
| `BOOKMARK_NAME_TAKEN_187` | 400 | PATCH bookmark | Rename target already occupied |
| `BULK_SET_LIMIT_187` | 400 | POST bulk-set | tokens array exceeds 50 |

---

## New endpoints (V187)

### DELETE /api/v1/workspaces/:workspaceId/events/stats/snapshots
- Reads + clears `_statsSnapshots185` for the given workspace.
- Idempotent: clearing an already-empty workspace returns `cleared: 0`.
- 200 `{ ok, workspaceId, cleared, ecosVersion }`.

### PATCH /api/v1/workspaces/:workspaceId/events/bookmarks/:name
- Body: `{ newName: string }` (≤128 chars, required).
- Mutates `_bookmarks184` in place; sets `renamedAt` on the record.
- 404 `BOOKMARK_NOT_FOUND_187` — `:name` absent.
- 400 `BOOKMARK_NAME_TAKEN_187` — `newName` already occupied.
- 400 (no code) — `newName` missing / empty / >128 chars.
- 200 `{ ok, workspaceId, oldName, newName, bookmark, ecosVersion }`.

### POST /api/v1/admin/tokens/bulk-set
- Body: `{ tokens: Array<{ workspaceId, token }> }` (≤`V187_BULK_SET_MAX` = 50).
- 400 `BULK_SET_LIMIT_187` — array too large.
- Calls `_tokenSvc181.setToken` per item; per-item failures do not abort the batch.
- 207 `{ ok, results, total, succeeded, failed, ecosVersion }`.
- Each result: `{ workspaceId, ok, error? }`.

### GET /api/v1/admin/summary/v187
- 200 with version `V187`, phase `P76`, feature list, config, and live stats.

---

## NODE_ENV=test exports added in V187

```
V187_BULK_SET_MAX
```

---

## Invariants status (post-V187)

| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (V178–V186) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |

---

## Common pitfalls (carry-forward + V187-specific)

- **BUG-L** (duplicate const): suffix all new identifiers `_xxx188` / `188`.
- **BUG-K** (shell corruption): if `__manus_ec` / `trap '' PIPE` appears in source,
  replace entire artifact.
- **Snapshot clear**: `_statsSnapshots185.delete(workspaceId)` is the correct idiom;
  V188 must not call `.clear()` on the outer Map.
- **Bookmark rename**: `_bookmarks184` inner Maps use `Map.delete` + `Map.set` for rename;
  do not mutate the key in-place.
- **Broadcast wrapper**: triple-wrapped — chain onto current `_broadcast179.broadcast`.
- **Token service**: `_tokenSvc181.setToken` validates token length (≤256); bulk-set
  per-item errors come from `TokenValidationError181` thrown by the service.
- **V186 expiry-query reuse**: `_tokenSvc181.hasToken` + `_tokenExpiry184` are authoritative;
  do not introduce parallel expiry maps.
- **V185 snapshot chain**: `_statsSnapshot185` iterates `_eventLog181.keys()`.
  V188 snapshot extensions MUST call `_statsSnapshot185` or chain after it.
