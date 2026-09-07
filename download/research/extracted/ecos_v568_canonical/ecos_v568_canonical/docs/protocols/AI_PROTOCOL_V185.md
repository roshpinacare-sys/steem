# AI_PROTOCOL_V185.md — ECOS V185 Operational Protocol

## Version
185.0.0 · Phase P74

## Purpose
Operational reference for AI assistants continuing ECOS development from V185.
Supplements `CLAUDE.md` (read that first).

---

## What changed in V185

| Tag | Component | Description |
|-----|-----------|-------------|
| V185-T01 | `GET /workspaces/:id/events/bookmarks/:name/resolve` | Resolve bookmark to ring-buffer event |
| V185-T02 | `_statsSnapshot185` + `GET /workspaces/:id/events/stats/history` | Rolling stats snapshot history (10-deep, 5-min interval) |
| V185-T03 | `GET /workspaces/:id/token/expiry` | Read-only token expiry introspection |
| V185-T04 | `GET /admin/summary/v185` | Admin summary with V185 stats |

---

## New constants (V185)

| Constant | Value | Purpose |
|----------|-------|---------|
| `V185_SNAPSHOT_MAX` | `10` | Rolling window depth |
| `V185_SNAPSHOT_INTERVAL_MS` | `300_000` | Snapshot scheduler period (5 min) |

---

## New in-memory stores (V185)

| Store | Type | Contents |
|-------|------|----------|
| `_statsSnapshots185` | `Map<wsId, Array<snapshot>>` | Rolling stats snapshots per workspace |

---

## New functions (V185)

| Function | Description |
|----------|-------------|
| `_computeStats185(workspaceId)` | Compute live stats from ring-buffer (same logic as V184-T01) |
| `_pushSnapshot185(workspaceId)` | Append current stats snapshot; prune to `V185_SNAPSHOT_MAX` |
| `_statsSnapshot185()` | Scheduled: snapshot all workspaces in `_eventLog181` |

---

## New endpoints (V185)

### GET /api/v1/workspaces/:workspaceId/events/bookmarks/:name/resolve
- Reads `_bookmarks184` (V184) and `_eventLog181` (V181).
- 404 `BOOKMARK_NOT_FOUND_185` — bookmark name absent.
- 404 `BOOKMARK_EVENT_NOT_IN_RING_185` — messageId evicted from ring.
- 200 `{ ok, workspaceId, bookmark, event, ecosVersion }`.

### GET /api/v1/workspaces/:workspaceId/events/stats/history
- Reads `_statsSnapshots185`.
- 200 `{ ok, workspaceId, snapshots, total, maxWindow, ecosVersion }`.

### GET /api/v1/workspaces/:workspaceId/token/expiry
- Reads `_tokenSvc181.hasToken()` and `_tokenExpiry184`.
- 200 `{ ok, workspaceId, hasToken, expiresAt, remainingMs, expired, ecosVersion }`.

### GET /api/v1/admin/summary/v185
- 200 with version `V185`, phase `P74`, feature list, config, and live stats.

---

## NODE_ENV=test exports added in V185

```
V185_SNAPSHOT_MAX, V185_SNAPSHOT_INTERVAL_MS,
_statsSnapshots185, _statsSnapshot185, _pushSnapshot185,
_computeStats185, _statsSnapshotTimer185
```

---

## Invariants status (post-V185)

| Rule | Status |
|------|--------|
| R1 — Sacred files | ✅ MD5 unchanged |
| R4 — No endpoint removal | ✅ |
| R5 — Prior suites (v178–v184) | ✅ All green |
| R6 — Zero new npm deps | ✅ |
| R8 — NODE_ENV=test exports | ✅ |

---

## Common pitfalls (carry-forward from prior versions)

- **BUG-L** (duplicate const): suffix all new identifiers `_xxx185`.
- **BUG-K** (shell corruption): if `__manus_ec` / `trap '' PIPE` appears in source,
  replace entire artifact.
- **V184 token patch**: `_patchTokenPost184` is already applied; V186 MUST chain.
- **V183 events/log patch**: `_patchEventsLog183` is already applied; V186 MUST chain.
- **Broadcast wrapper**: triple-wrapped — chain onto current `_broadcast179.broadcast`.
