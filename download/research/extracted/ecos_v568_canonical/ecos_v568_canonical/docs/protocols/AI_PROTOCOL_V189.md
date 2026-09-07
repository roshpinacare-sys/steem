# AI_PROTOCOL_V189.md — ECOS V189 Operational Protocol

## Version
189.0.0 · Phase P78

## Purpose
Operational reference for AI assistants continuing ECOS development from V189.
Supplements `CLAUDE.md` (read that first).

---

## What changed in V189

| Tag | Component | Description |
|-----|-----------|-------------|
| V189-T01 | `GET /workspaces/:id/events/stats/snapshots/latest` | Return most-recent snapshot in rolling window (read-only) |
| V189-T02 | `GET /workspaces/:id/events/bookmarks` | List all bookmarks with pagination (read-only) |
| V189-T03 | `POST /api/v1/admin/tokens/bulk-status` | Bulk token status introspection (≤50, HTTP 207, read-only) |
| V189-T04 | `GET /admin/summary/v189` | Admin summary with V189 stats |

---

## New constants (V189)

| Constant | Value | Purpose |
|----------|-------|---------|
| `V189_BULK_STATUS_MAX`   | `50`  | Max workspaceIds per bulk-status call |
| `V189_BOOKMARK_LIST_MAX` | `100` | Max bookmarks returned per list page  |

---

## New error codes (V189)

| Code | HTTP | Endpoint | Meaning |
|------|------|----------|---------|
| `BULK_STATUS_LIMIT_189` | 400 | POST bulk-status | workspaceIds array exceeds 50 |

---

## New endpoints (V189)

### GET /api/v1/workspaces/:workspaceId/events/stats/snapshots/latest
- Returns the most-recent entry from `_statsSnapshots185` for the given workspace.
- **Read-only**: does not mutate or delete the store.
- Missing workspace returns `snapshot: null, total: 0`.
- 200 `{ ok, workspaceId, snapshot|null, total, ecosVersion }`.

### GET /api/v1/workspaces/:workspaceId/events/bookmarks
- Lists all bookmarks from `_bookmarks184` for the given workspace.
- **Read-only**: does not mutate the store.
- Optional query params: `?limit=N&offset=N` (default limit = 100, max = `V189_BOOKMARK_LIST_MAX`).
- Empty workspace returns `bookmarks: [], total: 0`.
- 200 `{ ok, workspaceId, bookmarks, total, limit, offset, ecosVersion }`.

### POST /api/v1/admin/tokens/bulk-status
- Body: `{ workspaceIds: string[] }` (≤`V189_BULK_STATUS_MAX` = 50).
- 400 `BULK_STATUS_LIMIT_189` — array too large.
- **Read-only**: calls `_tokenSvc181.hasToken` and reads `_tokenExpiry184.get` without mutation.
- Per-item result: `{ workspaceId, hasToken, expiresAt|null, expired|null }`.
  - `expiresAt` is `null` if no expiry is set for the workspace.
  - `expired` is `null` if no expiry is set; `true/false` if expiry exists.
- Invalid workspaceId entries: `{ workspaceId: null, hasToken: false, expiresAt: null, expired: null, error: 'invalid workspaceId' }`.
- 207 `{ ok, results, total, ecosVersion }`.

### GET /api/v1/admin/summary/v189
- 200 with version `V189`, phase `P78`, feature list, config, and live stats.

---

## NODE_ENV=test exports added in V189

```
V188_BOOKMARK_BULK_DELETE_MAX (re-exported for test suite compatibility)
V188_BULK_CLEAR_V2_MAX (re-exported)
V187_BULK_SET_MAX (re-exported)
V189_BULK_STATUS_MAX
V189_BOOKMARK_LIST_MAX
```

---

## Invariants status (post-V189)

| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (V178–V188) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |

---

## Common pitfalls (carry-forward + V189-specific)

- **BUG-L** (duplicate const): suffix all new identifiers `_xxx190` / `190`.
- **BUG-K** (shell corruption): if `__manus_ec` / `trap '' PIPE` appears in source,
  replace entire artifact.
- **Snapshot store**: `_statsSnapshots185` is the canonical store; V190 must NOT introduce
  a parallel map. The latest endpoint is read-only.
- **Bookmark store**: `_bookmarks184` inner Maps; do not reassign the outer Map entry.
- **Bulk-status**: read-only; never call clearToken or delete from bulk-status handler.
- **Broadcast wrapper**: triple-wrapped — chain onto current `_broadcast179.broadcast`.
- **Token service**: `_tokenSvc181` is authoritative; do not introduce parallel token stores.
- **Export block**: The last `if (process.env.NODE_ENV === 'test')` block must include
  V187_BULK_SET_MAX (re-exported) so prior test suites using `lastIndexOf` continue to pass.
