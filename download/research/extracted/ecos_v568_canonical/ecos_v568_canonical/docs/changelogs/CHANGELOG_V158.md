# CHANGELOG_V158.md — ECOS Proof of Intellectual Work Node
## Version: V158 (semver 158.0.0) — Phase P47
## Released: 2026-05-30
## Status: CANONICAL

---

## Summary

V158 delivers **Workspace Task Management**, **Calibration History**, **Real-Time SSE Feed**, and **Deploy-Readiness** infrastructure. It adds 44 tasks to the server, 3 new library modules, 1 new middleware, and a 5-table DB migration. All sacred files (`lib/fiatLedger.js`, `lib/auditLog.js`) remain byte-for-byte identical to V157.

---

## New Library Modules (3)

### `lib/workspaceTaskService.js`
- `WorkspaceTaskService` class — in-memory + DB (PostgreSQL) hybrid CRUD engine
- `WorkspaceTask` typed model with id, title, description, status, priority, assigneeId, dueAt, tags, metadata, comments
- Exported constants: `VALID_STATUSES` (6 entries), `VALID_PRIORITIES` (4 entries)
- Methods: `createTask`, `listTasks` (cursor pagination), `getTask`, `updateTask`, `deleteTask`, `assignTask`, `bulkCreate` (≤100), `stats`, `getOverdueTasks`, `searchTasks`, `addComment`, `getComments`, `dump`
- DB fallback: all write ops continue in-memory if DB unavailable
- Full-text search: DB GIN index (`plainto_tsquery`) with in-memory substring fallback

### `lib/calibrationHistoryService.js`
- `CalibrationHistoryService` class — in-memory circular buffer (configurable `maxInMemory`) + DB
- `CalibrationFitRecord` model: `id`, `A`, `B`, `sampleCount`, `brier`, `auc`, `accuracy`, `trigger`, `fittedAt`, `note`
- Methods: `recordFit`, `list` (cursor paginated, trigger filter), `trends`, `exportCsv`, `setDb`
- Trends: `improving` / `degrading` / `stable` based on Brier score delta
- Patched into `calibrator.fit()` — every fit auto-records a `CalibrationFitRecord`

### `lib/workspaceRealTimeFeed.js`
- `WorkspaceFeedHub` — WebSocket-based broadcast hub (mirrors `AdminWsHub` pattern, workspace-scoped)
- `WorkspaceSSEFeed` — Server-Sent Events feed for browser clients; per-workspace subscription; 30-second keep-alive ping
- Both export `stats()` with `totalClients`, `byWorkspace`, `eventCount`
- Event helpers: `emitTaskCreated`, `emitTaskUpdated`, `emitTaskDeleted`, `emitTaskAssigned`, `emitCommentAdded`

---

## New Middleware (1)

### `middleware/workspaceAuth.js`
- `workspaceAuth(opts)` — validates workspace membership via injected `getMembership(workspaceId, userId)` function
- Admin bypass via `x-admin-token` header matching `ECOS_ADMIN_TOKEN` env var
- Returns `401` when userId missing; `403` when not a member
- Dev mode: passes through when no `getMembership` configured
- `requireWorkspaceRole(roles[])` — role-based access guard for workspace routes

---

## New DB Migration

### `db/migration_phase32.sql`
Five new tables:

| Table | Purpose |
|---|---|
| `workspace_tasks` | Task records with status, priority, assignee, dueAt, tags, metadata |
| `workspace_members` | Membership roster with role (owner/admin/manager/member/viewer) |
| `workspace_activity_log` | Audit trail of all workspace events |
| `workspace_task_comments` | Per-task threaded comments |
| `calibration_history` | Calibration fit history (A, B, brier, auc, accuracy) |

Indexes: GIN full-text, composite (workspace_id + status/priority/assignee/dueAt), `fitted_at DESC`.

Auto-update trigger on `workspace_tasks.updated_at`.

---

## New Endpoints (44 Tasks)

### Workspace Task CRUD
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/workspaces/:workspaceId/tasks` | Create task |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks` | List tasks (cursor pagination, filters) |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/:taskId` | Get single task |
| `PATCH` | `/api/v1/workspaces/:workspaceId/tasks/:taskId` | Update task |
| `DELETE` | `/api/v1/workspaces/:workspaceId/tasks/:taskId` | Delete task |
| `POST` | `/api/v1/workspaces/:workspaceId/tasks/bulk` | Bulk create (≤100 tasks) |
| `PATCH` | `/api/v1/workspaces/:workspaceId/tasks/bulk-status` | Bulk status update (≤200 tasks) |
| `POST` | `/api/v1/workspaces/:workspaceId/tasks/:taskId/assign` | Assign task to user |
| `POST` | `/api/v1/workspaces/:workspaceId/tasks/:taskId/status` | Set task status (alias) |

### Workspace Task Views
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/stats` | Task stats (byStatus, byPriority, overdue) |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/overdue` | Overdue tasks |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/search` | Full-text search (DB GIN + memory) |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/by-status` | Tasks grouped by status |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/priority-breakdown` | Tasks by priority |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/assignee-breakdown` | Tasks by assignee |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/timeline` | Timeline (overdue/upcoming/no-due-date) |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/export` | Export tasks as CSV |

### Task Comments
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/workspaces/:workspaceId/tasks/:taskId/comments` | Add comment |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/:taskId/comments` | List comments |

### Workspace Members & Activity
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/workspaces/:workspaceId/members` | List members |
| `POST` | `/api/v1/workspaces/:workspaceId/members` | Add/update member |
| `DELETE` | `/api/v1/workspaces/:workspaceId/members/:userId` | Remove member |
| `GET` | `/api/v1/workspaces/:workspaceId/activity` | Activity log |
| `GET` | `/api/v1/workspaces/:workspaceId/snapshot` | Full workspace snapshot |
| `GET` | `/api/v1/workspaces/:workspaceId/tasks/feed` | SSE real-time task feed |

### Calibration History
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/calibrator/history` | Calibration history (cursor paginated) |
| `GET` | `/api/v1/calibrator/history/trends` | Trend analysis |
| `GET` | `/api/v1/calibrator/history/export` | CSV export |
| `POST` | `/api/v1/calibrator/history/record` | Manual fit record |
| `GET` | `/api/v1/admin/calibrator/history` | Admin alias with trends |

### AI Metrics Charts
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/admin/ai-metrics/chart-data` | SVG chart data (bucketed time series) |
| `GET` | `/api/v1/admin/ai-metrics/trends` | Daily trend aggregates (7/30d) |

### Admin & Global
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/admin/workspace-tasks/global-stats` | Cross-workspace task totals |
| `GET` | `/api/v1/workspace-feed/stats` | SSE feed client stats |
| `GET` | `/api/v1/workspace-feed/v158/stats` | SSE feed stats (v158 alias) |

### System
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/deploy/check` | Pre-deploy readiness check (10 checks, 503 if critical fails) |
| `GET` | `/api/v1/system/readiness/v158` | V158 readiness with DB latency |
| `GET` | `/api/v1/health/v158` | V158 health endpoint |
| `GET` | `/api/v1/version` | V158 version with feature list (override) |
| `GET` | `/api/v1/system/changelog/v158` | V158 changelog via API |

---

## Test Suite

| File | Tests | Coverage |
|---|---|---|
| `tests/v158WorkspaceTasks.test.js` | 25 | WorkspaceTaskService CRUD, validation, pagination, search, comments, stats |
| `tests/v158CalibrationHistory.test.js` | 16 | recordFit, list, trends, CSV export, maxInMemory, setDb |
| `tests/v158DeployCheck.test.js` | 16 | WorkspaceFeedHub, WorkspaceSSEFeed, workspaceAuth, requireWorkspaceRole |
| **Total V158 new** | **57** | All pass ✓ |

**Cumulative test count: V157 ≥1551 + V158 57 = ≥1608**

---

## Sacred File Integrity (UNCHANGED)

```
lib/fiatLedger.js  MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✓ UNTOUCHED
lib/auditLog.js    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✓ UNTOUCHED
```

---

## Server Line Count

| Version | Lines |
|---|---|
| V157 | 9,104 |
| V158 | 9,764 |
| Delta | +660 |

---

## Breaking Changes

None. All V157 endpoints remain functional. V158 adds new routes with the `/api/v1/` prefix pattern — no existing routes modified.

---

## Dependency Changes

None. All new functionality uses Node.js built-ins (`crypto`, `events`, `fs`) plus existing `express`, `pg` already declared in `package.json`.

---

## Next: V159 Candidates

- Admin UI integration for workspace task board (drag-and-drop kanban)
- Workspace task webhook notifications (outbound HTTP)
- Validator task auto-assignment based on confidence scores
- Calibration history chart visualization in Admin WS Hub
- Task due-date reminder cron (integrate with metrics cron loop)
- `DELETE /api/v1/workspaces/:workspaceId` (workspace archive/soft-delete)
