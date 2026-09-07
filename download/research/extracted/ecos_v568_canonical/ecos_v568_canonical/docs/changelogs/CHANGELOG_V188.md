# CHANGELOG_V188.md — ECOS V188

## Version 188.0.0 · Phase P77

### Date
2026-05-30

### Summary
V188 adds snapshot export, bookmark bulk-delete, and an enhanced batch token-clear (v2)
that also purges `_tokenExpiry184` entries, plus the standard admin summary endpoint.

---

## Changes

### V188-T01 — Snapshot Export (`GET /workspaces/:id/events/stats/snapshots/export`)
- Returns all snapshots in the rolling window (`_statsSnapshots185`) as a JSON array.
- **Read-only**: does not delete or mutate the store.
- Response: `{ ok, workspaceId, snapshots, total, ecosVersion }`.

### V188-T02 — Bookmark Bulk Delete (`DELETE /workspaces/:id/events/bookmarks`)
- Accepts `{ names: string[] }` (≤`V188_BOOKMARK_BULK_DELETE_MAX` = 20).
- HTTP 207; per-name result `{ name, deleted, code|null }`.
- Error codes: `BOOKMARK_BULK_DELETE_LIMIT_188` (array too large), `BOOKMARK_NOT_FOUND_188`
  (name absent), `INVALID_NAME_188` (non-string entry).
- Mutates `_bookmarks184` in place; other bookmarks and other workspaces unaffected.

### V188-T03 — Batch Token Clear v2 (`POST /api/v1/admin/tokens/bulk-clear-v2`)
- Extends V183-T03: clears token via `_tokenSvc181.clearToken` **and** deletes the
  corresponding entry from `_tokenExpiry184`.
- Accepts `{ workspaceIds: string[] }` (≤`V188_BULK_CLEAR_V2_MAX` = 50). HTTP 207.
- Per-item result: `{ workspaceId, cleared, hadToken, hadExpiry, error? }`.
- Error code: `BULK_CLEAR_V2_LIMIT_188` (array too large).

### V188-T04 — Admin Summary (`GET /api/v1/admin/summary/v188`)
- Returns version `V188`, phase `P77`, feature list, config (all relevant constants),
  broadcast/token/persistence stats, eventLog, bookmarks, tokenExpiry, statsSnapshots.

---

## New constants
| Constant | Value | Purpose |
|----------|-------|---------|
| `V188_BOOKMARK_BULK_DELETE_MAX` | `20` | Max names per bulk-delete call |
| `V188_BULK_CLEAR_V2_MAX`        | `50` | Max workspaceIds per bulk-clear-v2 call |

## New error codes
| Code | HTTP | Endpoint | Meaning |
|------|------|----------|---------|
| `BOOKMARK_BULK_DELETE_LIMIT_188` | 400 | DELETE bookmarks | names array exceeds 20 |
| `BOOKMARK_NOT_FOUND_188`         | 207 | DELETE bookmarks (per-item) | named bookmark absent |
| `INVALID_NAME_188`               | 207 | DELETE bookmarks (per-item) | non-string name entry |
| `BULK_CLEAR_V2_LIMIT_188`        | 400 | POST bulk-clear-v2 | workspaceIds exceeds 50 |

## NODE_ENV=test exports added
```
V188_BOOKMARK_BULK_DELETE_MAX = 20
V188_BULK_CLEAR_V2_MAX = 50
```

---

## Invariants
| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (V178–V187) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |
