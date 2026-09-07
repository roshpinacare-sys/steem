# AI_PROTOCOL_V190.md — ECOS V190 Operational Protocol

## Version
190.0.0 · Phase P79

## Purpose
Operational reference for AI assistants continuing ECOS development from V190.
Supplements `CLAUDE.md` (read that first).

---

## What changed in V190

| Tag | Component | Description |
|-----|-----------|-------------|
| V190-T01 | `POST /workspaces/:id/events/stats/snapshots/trim` | Trim rolling snapshot window to keep N most-recent entries |
| V190-T02 | `GET /workspaces/:id/events/bookmarks/:name` | Get a single bookmark by name (read-only) |
| V190-T03 | `POST /api/v1/admin/tokens/bulk-rotate` | Rotate tokens for multiple workspaces (≤50, HTTP 207) |
| V190-T04 | `GET /admin/summary/v190` | Admin summary with V190 stats |

---

## New constants (V190)

| Constant | Value | Purpose |
|----------|-------|---------|
| `V190_SNAPSHOT_TRIM_MAX` | `10` | Max snapshots to retain after trim |
| `V190_BULK_ROTATE_MAX`   | `50` | Max workspaceIds per bulk-rotate call |

---

## New error codes (V190)

| Code | HTTP | Endpoint | Meaning |
|------|------|----------|---------|
| `SNAPSHOT_TRIM_INVALID_190` | 400 | POST snapshots/trim | `keep` param < 1 or > 10 |
| `BULK_ROTATE_LIMIT_190`     | 400 | POST bulk-rotate    | workspaceIds array exceeds 50 |

---

## New endpoints (V190)

### POST /api/v1/workspaces/:workspaceId/events/stats/snapshots/trim
- Trims the rolling snapshot window to keep only the N most-recent snapshots.
- Body: `{ keep: N }` where `1 ≤ N ≤ V190_SNAPSHOT_TRIM_MAX` (10).
- **Mutates** `_statsSnapshots185` — removes oldest entries in place.
- No-op if workspace has fewer than `keep` snapshots (returns `removed: 0`).
- 400 `SNAPSHOT_TRIM_INVALID_190` — `keep` out of range.
- 200 `{ ok, workspaceId, kept, removed, ecosVersion }`.

### GET /api/v1/workspaces/:workspaceId/events/bookmarks/:name
- Returns a single bookmark entry from `_bookmarks184` by name.
- **Read-only**: does not mutate the store.
- Missing bookmark returns `{ found: false, bookmark: null }` with HTTP 200 (not 404).
- 200 `{ ok, workspaceId, name, bookmark|null, found, ecosVersion }`.

### POST /api/v1/admin/tokens/bulk-rotate
- Body: `{ workspaceIds: string[] }` (≤`V190_BULK_ROTATE_MAX` = 50).
- 400 `BULK_ROTATE_LIMIT_190` — array too large.
- Rotates only workspaces that already have a token via `_tokenSvc181.setToken`.
- Workspaces without a token are **skipped** (`{ skipped: true, reason: 'no existing token' }`).
- New token is crypto-random (48 hex chars); response includes only masked form (first 4 + ****).
- Invalid workspaceId entries: `{ workspaceId: null, rotated: false, error: 'invalid workspaceId' }`.
- 207 `{ ok, results, total, ecosVersion }`.

### GET /api/v1/admin/summary/v190
- 200 with version `V190`, phase `P79`, feature list, config, and live stats.

---

## NODE_ENV=test exports added in V190

```
V189_BULK_STATUS_MAX (re-exported for test suite compatibility)
V189_BOOKMARK_LIST_MAX (re-exported)
V188_BOOKMARK_BULK_DELETE_MAX (re-exported)
V188_BULK_CLEAR_V2_MAX (re-exported)
V187_BULK_SET_MAX (re-exported)
V190_SNAPSHOT_TRIM_MAX
V190_BULK_ROTATE_MAX
```

---

## Invariants status (post-V190)

| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (V178–V189) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |

---

## Common pitfalls (carry-forward + V190-specific)

- **BUG-L** (duplicate const): suffix all new identifiers `_xxx191` / `191`.
- **BUG-K** (shell corruption): if `__manus_ec` / `trap '' PIPE` appears in source,
  replace entire artifact.
- **Snapshot store**: `_statsSnapshots185` is the canonical store; V191 must NOT introduce
  a parallel map. The trim endpoint mutates this store in place.
- **Bookmark store**: `_bookmarks184` inner Maps; do not reassign the outer Map entry.
- **Bulk-rotate**: only rotates workspaces with existing tokens; never creates a new token
  for a workspace that has none.
- **Token masking**: response must not expose the full new token — mask as first 4 chars + `****`.
- **Broadcast wrapper**: triple-wrapped — chain onto current `_broadcast179.broadcast`.
- **Token service**: `_tokenSvc181` is authoritative; do not introduce parallel token stores.
- **Export block**: The last `if (process.env.NODE_ENV === 'test')` block must include
  `V187_BULK_SET_MAX` (re-exported) so prior test suites using `lastIndexOf` continue to pass.
