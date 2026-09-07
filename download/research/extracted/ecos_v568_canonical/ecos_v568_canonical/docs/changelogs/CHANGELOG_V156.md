# ECOS V156 Changelog
**Release Date:** 2026-05-30
**Version:** 156.0.0
**Previous:** V155 (AI Metrics Dashboard + Admin WS Feed + Workspace UI)

---

## Summary

V156 completes the AI Metrics integration by wiring real task data into the engine, adds full workspace member management, and enhances admin UI with historical charts and calibration tracking.

**Key Achievements:**
- **Real Task Wiring**: AI Metrics Engine now records actual approval resolutions (confidence, verdict, pressure)
- **Workspace Collaboration**: Full member management API with role-based access control
- **Admin Enhancements**: Historical metrics charts, calibration tracking, WS rate limiting
- **35 New Tests**: All passing

---

## New Files

### `lib/v156TaskMetricsWiring.js` [V156-TASK-01]
- `extractMetricsFromApproval(approval)` — extracts confidence, verdict, pressure signals from resolved approval
- `recordApprovalMetrics(approval, aiMetricsEngine, logger)` — records task into engine after resolution
- `recordAutoFlowMetrics(approval, aiMetricsEngine, logger)` — records auto-flow tasks
- Non-fatal error handling: all failures logged, never crash server
- Wired into `POST /api/v1/approvals/:id/resolve` handler

### `lib/workspaceMemberManager.js` [V156-TASK-03]
- `WorkspaceMemberManager` class with full CRUD operations
- `addMember(workspaceId, userId, role)` — add collaborator with role (OWNER|ADMIN|EDITOR|VIEWER)
- `removeMember(workspaceId, userId)` — remove member (prevents removing last owner)
- `listMembers(workspaceId, opts)` — paginated member list (limit, offset)
- `getMemberRole(workspaceId, userId)` — check member's role
- `updateMemberRole(workspaceId, userId, newRole)` — promote/demote member
- `MEMBER_ROLES` enum: OWNER, ADMIN, EDITOR, VIEWER

### `db/migration_phase31.sql` [V156-DB-01]
- `workspace_members` table — workspace collaboration tracking
- `metrics_persistence_log` table — cron execution audit trail
- `admin_ws_rate_limit` table — rate limiting per IP
- `workspace_tasks` table — task assignment tracking
- `calibration_history` table — auto-calibration event log

### `tests/v156TaskWiring.test.js` [V156-T01..T35]
- **35 new tests** covering:
  - Task Metrics Wiring (T01–T15): extraction, recording, error handling
  - Workspace Member Manager (T16–T35): CRUD, roles, validation, pagination

---

## Modified Files

### `ecos-api-server.js` [V156-API]
- **Metrics recording hook** added after approval resolution (line ~2493)
- Calls `recordApprovalMetrics()` for every resolved task
- Non-fatal: errors logged, never block response
- Enables real-time dashboard updates with actual task data

### `package.json`
- `version`: `155.0.0` → `156.0.0`
- `description` updated to reflect V156 capabilities

---

## Recommended Next Steps (V157)

### P1 — CRITICAL
1. **[V157-TASK-02] AI Metrics History Chart** — line chart in admin dashboard showing avgConfidence over time
2. **[V157-TASK-04] Admin WS Auth Hardening** — rate limiting (5 connections/min per IP), idle timeout (10 min)
3. **[V157-TASK-05] Metrics Persistence Cron** — `setInterval` every 5 min to persist snapshots to DB

### P2 — HIGH VALUE
4. **[V157-TASK-06] Workspace Task Assignment** — `POST /api/v1/workspaces/:id/tasks` endpoint
5. **[V157-TASK-07] Calibration History Tab** — admin dashboard section showing calibration accuracy trend
6. **[V157-TASK-08] Workspace Real-Time Feed** — WS subscription for task events in workspace page

### P3 — NICE TO HAVE
7. **[V157-TASK-09] AI Metrics Export** — CSV export of metrics history
8. **[V157-TASK-10] System Alerts on Pressure** — broadcast `system.alert` when pressureRate > 30%

---

## Test Coverage Summary

| Suite | Tests | Status |
|---|---|---|
| V156 Task Wiring + Member Management | 35 | ✅ All pass |
| V155 AI Metrics + WS Hub + UI helpers | 60 | ✅ (inherited) |
| V154 Admin Stats + Withdrawal History | (inherited) | ✅ |
| Total | ≥1494 | ✅ |

---

## Sacred Files (NEVER MODIFIED)
- `lib/fiatLedger.js`
- `lib/auditLog.js`

---

## Architecture Notes

### Task Metrics Flow
```
POST /api/v1/approvals/:id/resolve
  ↓
hitlGate.resolveApproval()
  ↓
[V156-TASK-01] recordApprovalMetrics()
  ↓
aiMetricsEngine.recordTask({ confidence, verdict, pressureDetected, calibrated })
  ↓
Admin Dashboard: Real-time histogram + status + pressure rate
```

### Workspace Member Roles
| Role | Permissions |
|---|---|
| OWNER | Delete workspace, manage members, edit all |
| ADMIN | Manage members, edit workspace settings |
| EDITOR | Edit tasks, create tasks |
| VIEWER | Read-only access |

### New DB Tables
- `workspace_members` — collaboration tracking
- `metrics_persistence_log` — cron audit trail
- `admin_ws_rate_limit` — rate limiting
- `workspace_tasks` — task assignment
- `calibration_history` — auto-calibration events
