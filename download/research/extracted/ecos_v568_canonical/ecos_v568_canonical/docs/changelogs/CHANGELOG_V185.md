# CHANGELOG_V185.md — V185 (Phase P74)

## Summary

V185 extends ECOS with bookmark resolution, stats snapshot history, token expiry
introspection, and an updated admin summary — all implemented additively with zero
modification to prior-version code or sacred files.

---

## V185-T01 — Bookmark-to-Event Resolution

**Endpoint:** `GET /api/v1/workspaces/:workspaceId/events/bookmarks/:name/resolve`

Resolves a named cursor bookmark to its actual event entry from the workspace
ring-buffer (`_eventLog181`).

| Response case | HTTP | Code |
|---------------|------|------|
| Bookmark not found | 404 | `BOOKMARK_NOT_FOUND_185` |
| Bookmark exists but event evicted from ring | 404 | `BOOKMARK_EVENT_NOT_IN_RING_185` |
| Success | 200 | — |

Success response fields: `{ ok, workspaceId, bookmark, event, ecosVersion }`.
The `bookmark` object mirrors the V184 bookmark shape (`name`, `messageId`, `createdAt`).
The `event` object mirrors the V181 ring-buffer envelope shape
(`messageId`, `workspaceId`, `type`, `senderId`, `sentAt`, `payload`, `delivered`, `failed`).

Error codes introduced:
- `BOOKMARK_NOT_FOUND_185`
- `BOOKMARK_EVENT_NOT_IN_RING_185`

---

## V185-T02 — Stats Snapshot History

**Endpoint:** `GET /api/v1/workspaces/:workspaceId/events/stats/history`

Returns a rolling window of up to 10 past stats snapshots (oldest first) for a workspace.
Each snapshot captures a full V184-compatible stats object at a point in time.

**Scheduled capture:** `_statsSnapshot185()` fires every `V185_SNAPSHOT_INTERVAL_MS`
(5 minutes) and snapshots stats for every workspace present in `_eventLog181`.
The timer (`_statsSnapshotTimer185`) is `unref()`'d.

**Storage:** `_statsSnapshots185` — `Map<workspaceId, Array<snapshot>>`, capped at
`V185_SNAPSHOT_MAX = 10` entries per workspace (oldest pruned).

Each snapshot: `{ capturedAt: ISO-8601, stats: { totalEvents, typeCounts, firstAt, lastAt, topSenders } }`.

Response fields: `{ ok, workspaceId, snapshots, total, maxWindow, ecosVersion }`.

Constants introduced:
- `V185_SNAPSHOT_MAX = 10`
- `V185_SNAPSHOT_INTERVAL_MS = 300_000` (5 minutes)

---

## V185-T03 — Token Expiry Introspection

**Endpoint:** `GET /api/v1/workspaces/:workspaceId/token/expiry`

Returns live expiry introspection for a workspace token.

| Field | Type | Description |
|-------|------|-------------|
| `hasToken` | boolean | Whether a broadcast auth token is currently set |
| `expiresAt` | string \| null | ISO 8601 expiry datetime, or `null` if none |
| `remainingMs` | number \| null | Milliseconds until expiry (`0` if expired), or `null` if no expiry |
| `expired` | boolean | `true` if `expiresAt` is in the past |

Reads from `_tokenSvc181.hasToken()` (V181) and `_tokenExpiry184` (V184).
No mutation — read-only introspection endpoint.

---

## V185-T04 — Admin Summary V185

**Endpoint:** `GET /api/v1/admin/summary/v185`

Returns version `V185`, phase `P74`, feature list, config, and live stats for
broadcast, tokens, persistence, event log, bookmarks, token expiry, and stats snapshots.

---

## Invariants

| Rule | Status |
|------|--------|
| R1 — Sacred files (fiatLedger.js, auditLog.js) | ✅ UNTOUCHED (MD5 verified) |
| R4 — No endpoint removal | ✅ All prior endpoints preserved |
| R5 — Prior suites pass | ✅ v178–v184 all green |
| R6 — Zero new npm deps | ✅ Built-ins only |
| R8 — NODE_ENV=test exports | ✅ All new services exported |

## Test suite

`tests/v185.test.js` — **62 tests, 0 failed**

## Files changed

- `ecos-api-server.js` — appended V185 block (~251 lines)
- `package.json` — version bumped to `185.0.0`
- `tests/v185.test.js` — new (62 tests)
- `CHANGELOG_V185.md` — new (this file)
- `NEXT_SESSION_PROMPT_V185.md` — new
- `AI_PROTOCOL_V185.md` — new
- `CLAUDE.md` — updated (V185 state, P74 features)
