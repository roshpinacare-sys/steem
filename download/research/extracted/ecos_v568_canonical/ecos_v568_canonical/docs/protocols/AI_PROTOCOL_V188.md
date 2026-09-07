# AI_PROTOCOL_V188.md — ECOS V188 Operational Protocol

## Version
188.0.0 · Phase P77

## Purpose
Operational reference for AI assistants continuing ECOS development from V188.
Supplements `CLAUDE.md` (read that first).

---

## What changed in V188

| Tag | Component | Description |
|-----|-----------|-------------|
| V188-T01 | `GET /workspaces/:id/events/stats/snapshots/export` | Export all snapshots in rolling window (read-only) |
| V188-T02 | `DELETE /workspaces/:id/events/bookmarks` | Bulk-delete named bookmarks (≤20, HTTP 207) |
| V188-T03 | `POST /api/v1/admin/tokens/bulk-clear-v2` | Batch token clear, also purges `_tokenExpiry184` (≤50) |
| V188-T04 | `GET /admin/summary/v188` | Admin summary with V188 stats |

---

## New constants (V188)

| Constant | Value | Purpose |
|----------|-------|---------|
| `V188_BOOKMARK_BULK_DELETE_MAX` | `20` | Max names per bulk-delete call |
| `V188_BULK_CLEAR_V2_MAX`        | `50` | Max workspaceIds per bulk-clear-v2 call |

---

## New error codes (V188)

| Code | HTTP | Endpoint | Meaning |
|------|------|----------|---------|
| `BOOKMARK_BULK_DELETE_LIMIT_188` | 400 | DELETE bookmarks | names array exceeds 20 |
| `BOOKMARK_NOT_FOUND_188`         | 207 | DELETE bookmarks (per-item) | named bookmark absent |
| `INVALID_NAME_188`               | 207 | DELETE bookmarks (per-item) | non-string name entry |
| `BULK_CLEAR_V2_LIMIT_188`        | 400 | POST bulk-clear-v2 | workspaceIds exceeds 50 |

---

## New endpoints (V188)

### GET /api/v1/workspaces/:workspaceId/events/stats/snapshots/export
- Returns all snapshots from `_statsSnapshots185` for the given workspace.
- **Read-only**: does not mutate or delete the store.
- Empty workspace returns `snapshots: [], total: 0`.
- 200 `{ ok, workspaceId, snapshots, total, ecosVersion }`.

### DELETE /api/v1/workspaces/:workspaceId/events/bookmarks
- Body: `{ names: string[] }` (≤`V188_BOOKMARK_BULK_DELETE_MAX` = 20).
- Mutates `_bookmarks184` in place; removes matching entries.
- 400 `BOOKMARK_BULK_DELETE_LIMIT_188` — array too large.
- 207 per-name result: `{ name, deleted, code|null }`.
  - `BOOKMARK_NOT_FOUND_188` — name absent in store.
  - `INVALID_NAME_188` — non-string entry.
- Other bookmarks and other workspaces are unaffected.

### POST /api/v1/admin/tokens/bulk-clear-v2
- Body: `{ workspaceIds: string[] }` (≤`V188_BULK_CLEAR_V2_MAX` = 50).
- 400 `BULK_CLEAR_V2_LIMIT_188` — array too large.
- Calls `_tokenSvc181.clearToken` **and** `_tokenExpiry184.delete` per item.
- Per-item failures (invalid workspaceId) increment `skipped`; they do not abort the batch.
- 207 `{ ok, results, cleared, skipped, ecosVersion }`.
- Each result: `{ workspaceId, cleared, hadToken, hadExpiry, error? }`.

### GET /api/v1/admin/summary/v188
- 200 with version `V188`, phase `P77`, feature list, config, and live stats.

---

## NODE_ENV=test exports added in V188

```
V187_BULK_SET_MAX (re-exported for lastIndexOf test compatibility)
V188_BOOKMARK_BULK_DELETE_MAX
V188_BULK_CLEAR_V2_MAX
```

---

## Invariants status (post-V188)

| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (V178–V187) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |

---

## Common pitfalls (carry-forward + V188-specific)

- **BUG-L** (duplicate const): suffix all new identifiers `_xxx189` / `189`.
- **BUG-K** (shell corruption): if `__manus_ec` / `trap '' PIPE` appears in source,
  replace entire artifact.
- **Snapshot store**: `_statsSnapshots185` is the canonical store; V189 must NOT introduce
  a parallel map. The export endpoint is read-only; the clear endpoint (V187-T01) uses
  `_statsSnapshots185.delete(workspaceId)`.
- **Bookmark store**: `_bookmarks184` inner Maps use `Map.delete` for deletion; do not
  reassign the outer Map entry.
- **Token clear v2**: both `_tokenSvc181.clearToken` and `_tokenExpiry184.delete` must be
  called together for a consistent clear; V189 extensions must maintain this pairing.
- **Broadcast wrapper**: triple-wrapped — chain onto current `_broadcast179.broadcast`.
- **Token service**: `_tokenSvc181` is authoritative; do not introduce parallel token stores.
- **Export block**: The last `if (process.env.NODE_ENV === 'test')` block must include
  V187_BULK_SET_MAX (re-exported) so prior test suites using `lastIndexOf` continue to pass.
