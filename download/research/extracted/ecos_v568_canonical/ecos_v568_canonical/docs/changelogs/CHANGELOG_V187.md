# CHANGELOG_V187.md — ECOS V187 (Phase P76)

## Version
187.0.0 · Phase P76

## Date
2026-05-30

## Summary
V187 introduces three additive features building on the V184–V186 snapshot, bookmark,
and token infrastructure. Zero new npm dependencies. All prior test suites (V178–V186)
remain green.

---

## Changes

### V187-T01 — Snapshot Window Clear
**Endpoint:** `DELETE /api/v1/workspaces/:workspaceId/events/stats/snapshots`

Clears the rolling snapshot window for a workspace — useful for testing and manual reset.
Reads from (and deletes the key in) the existing `_statsSnapshots185` store.

Response shape:
```json
{
  "ok": true,
  "workspaceId": "...",
  "cleared": 3,
  "ecosVersion": "V187"
}
```

- `cleared` is the number of snapshots that were removed (0 if none existed).
- Idempotent: clearing an already-empty workspace returns `cleared: 0` with 200.
- Does **not** affect other workspaces' snapshot windows.

---

### V187-T02 — Bookmark Rename
**Endpoint:** `PATCH /api/v1/workspaces/:workspaceId/events/bookmarks/:name`

Renames an existing bookmark in `_bookmarks184`.
Body: `{ newName: string }` (≤128 chars, required).

Response shape:
```json
{
  "ok": true,
  "workspaceId": "...",
  "oldName": "alpha",
  "newName": "beta",
  "bookmark": { "name": "beta", "messageId": "...", "createdAt": "...", "renamedAt": "..." },
  "ecosVersion": "V187"
}
```

Error codes:
- `BOOKMARK_NOT_FOUND_187` (404) — `:name` does not exist for this workspace.
- `BOOKMARK_NAME_TAKEN_187` (400) — `newName` is already in use for this workspace.
- 400 (no code) — `newName` missing / empty / exceeds 128 chars.

The renamed bookmark record is updated in-place with a `renamedAt` timestamp.
The original `messageId` and `createdAt` are preserved.

---

### V187-T03 — Batch Token Set
**Endpoint:** `POST /api/v1/admin/tokens/bulk-set`

Sets broadcast-auth tokens in bulk via `_tokenSvc181.setToken`. HTTP 207.
Body: `{ tokens: Array<{ workspaceId, token }> }` (≤`V187_BULK_SET_MAX` = 50).

Response shape (HTTP 207):
```json
{
  "ok": true,
  "results": [
    { "workspaceId": "ws-1", "ok": true },
    { "workspaceId": "ws-2", "ok": false, "error": "token must be ≤256 characters" }
  ],
  "total": 2,
  "succeeded": 1,
  "failed": 1,
  "ecosVersion": "V187"
}
```

Error codes (top-level 400):
- `BULK_SET_LIMIT_187` — array exceeds 50.

Per-item failures do **not** abort the batch; each entry is processed independently.

---

### V187-T04 — Admin Summary V187
**Endpoint:** `GET /api/v1/admin/summary/v187`

Returns version `V187`, phase `P76`, feature list, config snapshot, and live stats for
all tracked stores (broadcast, tokens, persistence, eventLog, bookmarks, tokenExpiry,
statsSnapshots).

---

## New constants (V187)

| Constant | Value | Purpose |
|----------|-------|---------|
| `V187_BULK_SET_MAX` | `50` | Max entries per bulk-set call |

## New error codes (V187)

| Code | HTTP | Meaning |
|------|------|---------|
| `BOOKMARK_NOT_FOUND_187` | 404 | Named bookmark absent |
| `BOOKMARK_NAME_TAKEN_187` | 400 | Rename target already exists |
| `BULK_SET_LIMIT_187` | 400 | tokens array exceeds 50 |

---

## Invariants (post-V187)

| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (V178–V186) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |
