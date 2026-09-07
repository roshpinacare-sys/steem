# CHANGELOG_V190.md — ECOS V190

## Version 190.0.0 · Phase P79

### Date
2026-05-30

### Summary
V190 adds snapshot-window trimming, single-bookmark retrieval, and a bulk token-rotation
endpoint, plus the standard admin summary endpoint.

---

## Changes

### V190-T01 — Snapshot Trim (`POST /workspaces/:id/events/stats/snapshots/trim`)
- Trims the rolling snapshot window for a workspace to retain only the N most-recent snapshots.
- Body: `{ keep: N }` where `1 ≤ N ≤ V190_SNAPSHOT_TRIM_MAX` (10).
- Mutates `_statsSnapshots185` — removes oldest entries, keeps last N.
- Returns `{ ok, workspaceId, kept, removed, ecosVersion }`.
- Error code `SNAPSHOT_TRIM_INVALID_190` (HTTP 400) when `keep` is out of range.
- No-op if the workspace has fewer than `keep` snapshots (returns `removed: 0`).

### V190-T02 — Bookmark Get (`GET /workspaces/:id/events/bookmarks/:name`)
- Returns a single bookmark entry from `_bookmarks184` by name.
- **Read-only**: does not mutate the store.
- Returns `{ ok, workspaceId, name, bookmark|null, found, ecosVersion }`.
- Missing bookmark returns `found: false, bookmark: null` (HTTP 200, not 404).

### V190-T03 — Bulk Token Rotate (`POST /api/v1/admin/tokens/bulk-rotate`)
- Rotates (regenerates) tokens for multiple workspaces in bulk.
- Body: `{ workspaceIds: string[] }` (≤`V190_BULK_ROTATE_MAX` = 50). HTTP 207.
- Only rotates workspaces that already have a token; others are skipped with `skipped: true`.
- Uses `_tokenSvc181.setToken` to store a new crypto-random token.
- Per-item result: `{ workspaceId, rotated, token (masked, first 4 chars + ****), skipped?, error? }`.
- Error code: `BULK_ROTATE_LIMIT_190` when array exceeds 50 entries.

### V190-T04 — Admin Summary (`GET /api/v1/admin/summary/v190`)
- Returns version `V190`, phase `P79`, feature list, config (all relevant constants),
  broadcast/token/persistence stats, eventLog, bookmarks, tokenExpiry, statsSnapshots.

---

## New constants
| Constant | Value | Purpose |
|----------|-------|---------|
| `V190_SNAPSHOT_TRIM_MAX` | `10` | Max snapshots to retain after trim |
| `V190_BULK_ROTATE_MAX`   | `50` | Max workspaceIds per bulk-rotate call |

## New error codes
| Code | HTTP | Endpoint | Meaning |
|------|------|----------|---------|
| `SNAPSHOT_TRIM_INVALID_190` | 400 | POST snapshots/trim | `keep` out of range (< 1 or > 10) |
| `BULK_ROTATE_LIMIT_190`     | 400 | POST bulk-rotate    | workspaceIds array exceeds 50 |

## NODE_ENV=test exports added
```
V190_SNAPSHOT_TRIM_MAX = 10
V190_BULK_ROTATE_MAX   = 50
```

---

## Invariants
| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (V178–V189) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |
