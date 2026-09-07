# CHANGELOG_V178.md — ECOS V178 (Phase P67)

  **Release date:** 2026-05-30
  **Base:** V177 canonical
  **Server:** ecos-api-server.js · 14,464 lines
  **package.json:** 178.0.0
  **Test suite:** tests/v178.test.js · 60 tests, 0 failures

  ---

  ## P67 Deliverables

  ### V178-T01 · WorkspaceHeartbeatService (`lib/workspaceHeartbeatService.js`)

  New pure-in-memory heartbeat tracker for WebSocket client presence.

  **Design:**
  - Token-bucket presence model per workspaceId (Map)
  - Configurable stale TTL (default 60 s) and sweep interval (default 30 s)
  - Optional `presenceCallback(workspaceId, event)` hook for WS broadcasting
  - Sweep timer runs on `unref()`d interval — does not prevent process exit in tests

  **API:**
  - `ping(workspaceId, { userId?, meta? })` → snapshot; fires `connected` event on first ping
  - `disconnect(workspaceId)` → `{ removed }`; fires `disconnected` event
  - `getStatus(workspaceId)` → snapshot | null
  - `listActive()` → non-stale snapshots
  - `stats()` → `{ activeWorkspaces, trackedWorkspaces, totalPings, totalEvictions, staleTtlMs, sweepIntervalMs, pingIntervalMs }`
  - `shutdown()` → clears sweep timer

  **Snapshot shape:**
  ```json
  { "workspaceId": "ws-abc", "lastPing": "...", "userId": "u-1", "meta": {},
    "pingCount": 3, "ageMs": 1200, "isStale": false, "pingIntervalMs": 15000 }
  ```

  **Environment variable:**
  | Variable | Default | Meaning |
  |---|---|---|
  | `WORKSPACE_HEARTBEAT_TTL_MS` | 60000 | ms after last ping before stale eviction |

  ---

  ### V178-T02 · POST /api/v1/workspaces/:id/heartbeat

  Register or refresh a heartbeat ping.

  - Body: `{ userId?, meta? }` (both optional)
  - Returns: heartbeat snapshot (200)
  - Idempotent — repeated pings update `lastPing` and increment `pingCount`

  ---

  ### V178-T03 · DELETE /api/v1/workspaces/:id/heartbeat

  Explicitly disconnect a workspace (client graceful close).

  - Returns: `{ removed: boolean, workspaceId }`

  ---

  ### V178-T04 · GET /api/v1/workspaces/:id/heartbeat

  Get the current heartbeat status.

  - Returns snapshot if active, or `{ status: null, note: "No active heartbeat" }`

  ---

  ### V178-T05 · GET /api/v1/admin/heartbeats

  Admin view: list all active (non-stale) heartbeats + aggregate stats.

  - Returns: `{ active: [...], stats: { activeWorkspaces, totalPings, ... } }`

  ---

  ### V178-T06 · POST /api/v1/workspaces/:id/events/bulk

  Bulk event ingestion — up to 100 events per call.

  **Request body:**
  ```json
  { "events": [ { "eventType": "task.completed", "actorId": "u-1", "payload": {} }, ... ] }
  ```

  **Rules:**
  - Max 100 events per call → `BULK_LIMIT_EXCEEDED` (400) if exceeded
  - Empty array → 200, no-op
  - Each event must have `eventType` or it is rejected individually
  - Events are written to the audit trail when available
  - IDs generated via `vendor/nanoid` (21-char, zero new deps)

  **Response:** HTTP 207 Multi-Status
  ```json
  { "ok": true, "accepted": 95, "rejected": 5, "total": 100,
    "results": [ { "ok": true, "id": "...", "eventType": "task.completed" }, ... ] }
  ```

  ---

  ### V178-T03 Search · Relevance Scoring + sortBy Param (in-place upgrade)

  The search route (`GET /workspaces/:id/search`) now adds a `score` field to every result and accepts a `sortBy` query parameter.

  **Score algorithm (0.0 – 1.0):**
  | Match | Score |
  |---|---|
  | Exact title/name match | 1.0 |
  | Title starts with query | 0.9 |
  | Title contains query | 0.8 |
  | Body/description contains query | 0.65 |
  | No match | 0.5 (baseline) |

  **sortBy values:**
  - `relevance` (default) — descending score
  - `date` — descending `createdAt`

  Response now includes `sortBy` field.

  ---

  ### V178-T07 · GET /api/v1/admin/summary/v178

  Admin summary for V178 phase.

  ```json
  {
    "version": "V178", "phase": "P67",
    "features": ["workspace-heartbeat-service", "bulk-event-ingestion", "search-relevance-scoring", "admin-heartbeat-monitor"],
    "config": { "heartbeatStaleTtlMs": 60000, "bulkEventLimit": 100 },
    "stats": { "heartbeat": {...}, "rateLimiter": {...} }
  }
  ```

  ---

  ## Infrastructure Improvements

  ### CLAUDE.md — AI Session Entry Point
  Added `CLAUDE.md` at the repo root as a single-document entry point for Claude and other AI assistants. Contains: project identity, sacred invariants, current state, all feature tags V175–V178, key services index, packaging rules, and suggested next work items. Replaces the need to hunt across 20+ AI_PROTOCOL files at the start of each session.

  ### NODE_ENV=test Exports (R8)
  New exports added:
  - `_heartbeat178` — V178 heartbeat singleton
  - `WorkspaceHeartbeatService178` — constructor alias
  - `HeartbeatValidationError178` — error class
  - `_hb178StaleTtl` — configured TTL value
  - `V178_BULK_MAX` — bulk limit constant (100)

  All V177/V176/V175 exports preserved (R8).

  ---

  ## Invariants

  - **R1 Sacred files:** `lib/fiatLedger.js` MD5 `563e9b1f9e67091a5b6527c0a92568e5` — UNTOUCHED.
    `lib/auditLog.js` MD5 `e5a5c2c27801d2d03991bc8e5a1df8cb` — UNTOUCHED.
  - **R4 No removal:** All prior endpoints preserved.
  - **R5 Prior tests:** v177/v176/v175 suites pass (version checks excluded).
  - **R6 Zero new npm deps:** `workspaceHeartbeatService` uses only Node.js built-ins.
  - **R8 Test exports:** All new services exported under `NODE_ENV=test`.
  