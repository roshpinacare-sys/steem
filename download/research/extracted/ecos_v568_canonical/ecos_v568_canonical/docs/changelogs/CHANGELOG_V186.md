# CHANGELOG_V186.md — ECOS V186 (Phase P75)

## Version
186.0.0 · Phase P75

## Date
2026-05-31

## Summary
V186 introduces three additive features building on the V184–V185 event-log,
bookmark, and token-expiry infrastructure. Zero new npm dependencies.
All prior test suites (V178–V185) remain green.

---

## Changes

### V186-T01 — Stats Snapshot Diff
**Endpoint:** `GET /api/v1/workspaces/:workspaceId/events/stats/diff`

Returns the delta between the two most-recent stats snapshots in the
rolling window (`_statsSnapshots185`).

Response shape:
```json
{
  "ok": true,
  "workspaceId": "...",
  "prevSnapshot": { "capturedAt": "...", "stats": {...} },
  "currSnapshot": { "capturedAt": "...", "stats": {...} },
  "diff": {
    "added":   { "typeCounts.newType": { "prev": null, "curr": 3 } },
    "removed": {},
    "changed": { "totalEvents": { "prev": 10, "curr": 15 } }
  },
  "ecosVersion": "V186"
}
```

Error codes:
- `INSUFFICIENT_SNAPSHOTS_186` (404) — fewer than 2 snapshots captured yet.

New helper: `_diffSnapshots186(prev, curr)` — pure function, no side effects.

---

### V186-T02 — Bookmark Batch Resolve
**Endpoint:** `POST /api/v1/workspaces/:workspaceId/events/bookmarks/resolve-batch`

Accepts `{ names: string[] }` (≤20 names, enforced by `V186_BATCH_RESOLVE_MAX`).
Resolves each name against `_bookmarks184` and `_eventLog181` in one request.

Per-name result shape:
```json
{ "name": "bk1", "found": true, "bookmark": {...}, "event": {...}, "code": null }
{ "name": "bk2", "found": false, "event": null, "code": "BOOKMARK_NOT_FOUND_185" }
{ "name": "bk3", "found": false, "bookmark": {...}, "event": null, "code": "BOOKMARK_EVENT_NOT_IN_RING_185" }
```

Response shape:
```json
{
  "ok": true, "workspaceId": "...",
  "results": [...], "total": 3, "resolved": 1,
  "ecosVersion": "V186"
}
```

Error codes (validation):
- `BATCH_RESOLVE_LIMIT_186` (400) — names array exceeds 20.

---

### V186-T03 — Token Expiry Bulk Query
**Endpoint:** `POST /api/v1/admin/tokens/expiry-query`

Accepts `{ workspaceIds: string[] }` (≤50, enforced by `V186_EXPIRY_QUERY_MAX`).
Returns per-workspace token expiry introspection, reusing V185-T03 logic
(`_tokenSvc181.hasToken` + `_tokenExpiry184`).

Per-workspace result shape:
```json
{
  "workspaceId": "ws-1",
  "hasToken": true,
  "expiresAt": "2026-06-01T00:00:00Z",
  "remainingMs": 86400000,
  "expired": false
}
```

Response shape:
```json
{ "ok": true, "results": [...], "total": 3, "ecosVersion": "V186" }
```

Error codes (validation):
- `EXPIRY_QUERY_LIMIT_186` (400) — workspaceIds exceeds 50.

---

### V186-T04 — Admin Summary V186
**Endpoint:** `GET /api/v1/admin/summary/v186`

Returns version `V186`, phase `P75`, feature list, config (including
`batchResolveMax` and `expiryQueryMax`), and live stats.

---

## New Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `V186_BATCH_RESOLVE_MAX` | `20` | Max names per batch-resolve request |
| `V186_EXPIRY_QUERY_MAX`  | `50` | Max workspaceIds per expiry-query request |

## New Functions

| Function | Description |
|----------|-------------|
| `_diffSnapshots186(prev, curr)` | Pure diff between two stats snapshot objects |

## New Endpoints

| Tag | Method + Path | Description |
|-----|---------------|-------------|
| V186-T01 | `GET /workspaces/:id/events/stats/diff` | Delta between last two snapshots |
| V186-T02 | `POST /workspaces/:id/events/bookmarks/resolve-batch` | Batch bookmark resolution (≤20) |
| V186-T03 | `POST /admin/tokens/expiry-query` | Bulk token expiry query (≤50) |
| V186-T04 | `GET /admin/summary/v186` | Admin summary |

## NODE_ENV=test Exports Added

```
V186_BATCH_RESOLVE_MAX, V186_EXPIRY_QUERY_MAX, _diffSnapshots186
```

## Invariants

| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (V178–V185) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |
