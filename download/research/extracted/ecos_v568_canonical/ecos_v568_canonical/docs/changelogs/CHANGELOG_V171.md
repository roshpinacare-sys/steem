# CHANGELOG — V171

## Version: 171.0.0 | Phase: P60 | Date: 2026-05-30

---

## Summary

V171 implements **P60 high-value features** from the V170 roadmap:
1. **Task Dependencies REST** — per-task dependency CRUD with circular-dependency detection and `isBlocked` check, exposed via dedicated REST endpoints (builds on existing `lib/taskDependencyService.js`)
2. **Workspace Notifications Center** — in-app notification center per user per workspace: create, list (with unread count), mark-read, mark-all-read, delete

---

## New Lib Modules (1)

| File | Lines | Purpose |
|---|---|---|
| `lib/workspaceNotificationService.js` | ~280 | Workspace notifications: create/list/markRead/markAllRead/delete, unread count, type validation, per-user 500-notif limit |

---

## New DB Migration

**Phase 45** (`db/migration_phase45.sql`) — 1 new table + 6 indexes:
- `workspace_notifications` — in-app notifications per user per workspace
  - `idx_wn_workspace_user`
  - `idx_wn_workspace_user_unread` (partial index WHERE read=FALSE)
  - `idx_wn_created_at`
  - `idx_wn_workspace`
  - `idx_wn_user`
  - `idx_wn_type`

Note: `task_dependencies` table already existed from Phase 34 (V160). V171 adds REST endpoints on top of the existing service without any schema changes.

---

## New API Endpoints (10) — V171-T01 … V171-T10

### Block A — Task Dependencies REST (T01–T04)
| Tag | Method | Path |
|---|---|---|
| V171-T01 | POST   | `/api/v1/workspaces/:workspaceId/tasks/:taskId/dependencies` |
| V171-T02 | GET    | `/api/v1/workspaces/:workspaceId/tasks/:taskId/dependencies` |
| V171-T03 | DELETE | `/api/v1/workspaces/:workspaceId/tasks/:taskId/dependencies/:depId` |
| V171-T04 | GET    | `/api/v1/workspaces/:workspaceId/tasks/:taskId/dependencies/blocked` |

### Block B — Workspace Notifications Center (T05–T09)
| Tag | Method | Path |
|---|---|---|
| V171-T05 | POST   | `/api/v1/workspaces/:workspaceId/notifications` |
| V171-T06 | GET    | `/api/v1/workspaces/:workspaceId/notifications` |
| V171-T07 | PATCH  | `/api/v1/workspaces/:workspaceId/notifications/:notifId/read` |
| V171-T08 | PATCH  | `/api/v1/workspaces/:workspaceId/notifications/read-all` |
| V171-T09 | DELETE | `/api/v1/workspaces/:workspaceId/notifications/:notifId` |

### Block C — Admin (T10)
| Tag | Method | Path |
|---|---|---|
| V171-T10 | GET | `/api/v1/admin/system/summary/v171` |

---

## Feature Details

### Task Dependencies REST (V171-T01–T04)
Built on `lib/taskDependencyService.js` (V160). REST layer adds:
- `POST …/dependencies` → `{ dependency, alreadyExists }` — 201 on create, 200 if already exists; 409 on cyclic dependency
- `GET  …/dependencies` → `{ taskId, dependsOn[], requiredBy[], isBlocked, blockers[], tree? }` — optional `?includeTree=true`
- `DELETE …/dependencies/:depId` → `{ deleted, dependency }` — depId is the `dependsOnId` task
- `GET  …/dependencies/blocked` → `{ taskId, blocked, blockers[] }`
- Cycle detection: DFS; self-dependency and transitive cycles both rejected with `CYCLIC_DEPENDENCY` (409)

### Workspace Notifications Center (V171-T05–T09)
New `lib/workspaceNotificationService.js`:
- `createNotification(workspaceId, opts)` → `WorkspaceNotification`
  - `userId` + `title` required
  - `type` one of: `info` | `warning` | `success` | `error` | `mention` | `assignment` | `system` (default `info`)
  - `body` optional (≤2000 chars), `meta` optional JSON
  - Max 500 notifications per user per workspace (`NOTIFICATION_LIMIT_REACHED` 429)
  - `title` ≤200 chars
- `listNotifications(workspaceId, userId, opts)` → `{ notifications[], total, unreadCount }`
  - `?unreadOnly=true` — filter to unread only
  - `?limit=50&offset=0` — pagination
- `markRead(workspaceId, userId, notifId)` → `WorkspaceNotification` — idempotent
- `markAllRead(workspaceId, userId)` → `{ markedCount }` — bulk mark-read for user
- `deleteNotification(workspaceId, userId, notifId)` → `{ deleted, notifId, title }`
- All operations scoped to (workspaceId + userId) — 404 on ownership mismatch

---

## Tests

| File | Tests | Status |
|---|---|---|
| `tests/v171.test.js` | 40 | ✓ PASS |
| `tests/v170.test.js` | 41 | ✓ PASS (regression) |

---

## Cumulative Metrics

| Metric | V170 | V171 |
|---|---|---|
| Server lines (`ecos-api-server.js`) | 13,381 | **13,603** |
| Total endpoints | 201 | **211** |
| Cumulative tests | ≥2,182 | **≥2,222** |
| DB migration phase | 44 | **45** |
| Total lib modules | ~60 | **~61** |

---

## Sacred Files

| File | MD5 | Status |
|---|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |

---

## Protocol Compliance

- ✓ R1 — Sacred files untouched (MD5 verified)
- ✓ R2 — Endpoint tags V171-T01…T10 monotonically increasing
- ✓ R3 — Full canonical ZIP (all dirs included)
- ✓ R4 — No prior endpoints renumbered
- ✓ R5 — All V170 tests pass (regression verified)
- ✓ R6 — Zero new external dependencies
- ✓ R7 — In-memory + DB dual persistence in new service file
- ✓ R8 — NODE_ENV=test export block in new lib file
- ✓ R9 — Handoff docs: CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL
- ✓ R10 — JSDoc blocks with version tags in new lib file
- ✓ R12 — Audit trail append-only (unchanged)
