# CHANGELOG_V189.md — ECOS V189

## Version 189.0.0 · Phase P78

### Date
2026-05-30

### Summary
V189 adds snapshot-latest retrieval, bookmark listing with pagination, and a bulk token-status
introspection endpoint, plus the standard admin summary endpoint.

---

## Changes

### V189-T01 — Snapshot Latest (`GET /workspaces/:id/events/stats/snapshots/latest`)
- Returns the most-recent snapshot entry in the rolling window (`_statsSnapshots185`).
- **Read-only**: does not delete or mutate the store.
- Returns `snapshot: null` when no snapshots exist for the workspace.
- Response: `{ ok, workspaceId, snapshot|null, total, ecosVersion }`.

### V189-T02 — Bookmark List (`GET /workspaces/:id/events/bookmarks`)
- Lists all bookmarks for a workspace from `_bookmarks184`.
- **Read-only**: does not mutate the store.
- Optional query params: `?limit=N&offset=N` (default limit = `V189_BOOKMARK_LIST_MAX` = 100).
- Response: `{ ok, workspaceId, bookmarks, total, limit, offset, ecosVersion }`.
- Empty workspace returns `bookmarks: [], total: 0`.

### V189-T03 — Bulk Token Status (`POST /api/v1/admin/tokens/bulk-status`)
- Accepts `{ workspaceIds: string[] }` (≤`V189_BULK_STATUS_MAX` = 50). HTTP 207.
- Per-item result: `{ workspaceId, hasToken, expiresAt|null, expired|null }`.
- Read-only: uses `_tokenSvc181.hasToken` and reads `_tokenExpiry184` without mutation.
- Error code: `BULK_STATUS_LIMIT_189` (array too large).

### V189-T04 — Admin Summary (`GET /api/v1/admin/summary/v189`)
- Returns version `V189`, phase `P78`, feature list, config (all relevant constants),
  broadcast/token/persistence stats, eventLog, bookmarks, tokenExpiry, statsSnapshots.

---

## New constants
| Constant | Value | Purpose |
|----------|-------|---------|
| `V189_BULK_STATUS_MAX`   | `50`  | Max workspaceIds per bulk-status call |
| `V189_BOOKMARK_LIST_MAX` | `100` | Max bookmarks returned per list page  |

## New error codes
| Code | HTTP | Endpoint | Meaning |
|------|------|----------|---------|
| `BULK_STATUS_LIMIT_189` | 400 | POST bulk-status | workspaceIds array exceeds 50 |

## NODE_ENV=test exports added
```
V189_BULK_STATUS_MAX = 50
V189_BOOKMARK_LIST_MAX = 100
```

---

## Invariants
| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (V178–V188) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |
