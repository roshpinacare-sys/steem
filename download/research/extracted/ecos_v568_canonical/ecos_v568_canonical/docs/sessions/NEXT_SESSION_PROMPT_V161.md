# Next Session Prompt — V161 → V162

## Context Summary

**Current version:** V161 (Phase P50 COMPLETE)
**Server:** `ecos-api-server.js` — 11,733 lines
**Cumulative tests:** ≥1,812 (V161: +66 new; all passing ✓)
**DB Migrations:** Phase 35 applied (6 new tables)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`
**apps/web:** RESTORED (35 frontend files, Next.js, from V157 canonical)

---

## V161 Deliverables Completed

### New Lib Modules
- `lib/workspaceLabelsService.js` — color-coded labels CRUD + apply/remove per task + stats (312 lines)
- `lib/workspaceTaskCommentService.js` — threaded comments, soft-delete, emoji reactions (336 lines)
- `lib/workspaceTaskSlaService.js` — SLA policies per priority, breach detection, bulkCheck, escalation levels (328 lines)
- `lib/workspaceAuditTrailService.js` — SHA-256 chained append-only audit log with chain verification (260 lines)

### DB — Phase 35 (6 tables)
`workspace_labels`, `workspace_task_labels`, `workspace_task_comments`,
`workspace_sla_policies`, `workspace_sla_events`, `workspace_audit_trail`

DB-level immutability triggers on `workspace_audit_trail` (deny UPDATE/DELETE).

### API Endpoints (36 tasks — V161-T01 … V161-T36)
- Block A: Labels (T01–T10) — CRUD + apply/remove per task + stats
- Block B: Comments (T11–T18) — threaded CRUD + reactions + stats
- Block C: SLA Policies (T19–T28) — policy CRUD + check + bulk-check + events + stats
- Block D: Audit Trail (T29–T33) — list + export + verify + stats + manual record
- Block E: Admin/Integration (T34–T36) — summary/v161, deploy/check/v161, version

### Tests
- `tests/v161Labels.test.js`   — 21 tests ✓ PASS
- `tests/v161Comments.test.js` — 22 tests ✓ PASS
- `tests/v161SlaAudit.test.js` — 23 tests ✓ PASS

---

## Cumulative State at V161

| Metric | Value |
|---|---|
| Server lines (`ecos-api-server.js`) | 11,733 |
| Total endpoints | 130 |
| Cumulative tests | ≥1,812 |
| DB migration phase | 35 |
| Total lib modules | ~45+ |
| apps/web frontend | ✓ Present (35 JSX files) |

---

## V162 Candidates — Phase P51

### P1 (Critical / Highest Value)

1. **Task Recurrence Scheduling** (`lib/workspaceTaskRecurrenceService.js`)
   - Recurring tasks: daily / weekly / monthly via simple rule string
   - Auto-create next task when current one completes
   - DB column: add `recurrence_rule TEXT` to `workspace_tasks`
   - Endpoints: `POST /workspaces/:id/tasks/:taskId/recurrence`, `DELETE ...`, `GET /workspaces/:id/tasks/recurring`
   - Integration: emit `task.created` audit event on auto-spawn

2. **Workspace Bulk Operations** (`lib/workspaceBulkOpsService.js`)
   - `POST /workspaces/:id/tasks/bulk-status` — change status for up to 500 tasks
   - `POST /workspaces/:id/tasks/bulk-assign` — bulk assign to validator
   - `DELETE /workspaces/:id/tasks/bulk-delete` — soft-delete batch
   - Each bulk op emits audit trail events
   - Returns per-task result array `[{ taskId, ok, error }]`

3. **Task Time Tracking** (`lib/workspaceTimeTrackingService.js`)
   - Log work sessions per task: `startTimer` / `stopTimer` / `logManual`
   - Per-task total: summed logged hours
   - Per-workspace leaderboard: most hours logged
   - DB: `workspace_time_entries` table
   - Endpoints: start/stop/log/list/summary/leaderboard (≥8 endpoints)

4. **Comment Mentions + Notifications** (extend `workspaceTaskCommentService.js`)
   - Parse `@userId` mentions in comment body
   - Emit notification via existing `notificationService` for each mentioned user
   - Endpoint: `GET /workspaces/:id/tasks/:taskId/comments/:commentId/mentions`

### P2 (High Value)

5. **Enhanced Label Filtering on Task List**
   - Extend `GET /workspaces/:id/tasks` to accept `?labelId[]=` query param
   - Returns only tasks with all specified labels (AND logic)
   - No new lib needed — extend `workspaceTaskService.js`

6. **SLA Report by Assignee**
   - `GET /workspaces/:id/sla/report/by-assignee` — breach counts per validator
   - Uses in-memory SLA events + task assignee data
   - Returns ranked list: worst-performing assignees first

7. **Audit Trail Webhook Push**
   - When an audit event is recorded, push to all `workspace_webhooks` with `event_type === 'audit.*'`
   - Filter: only push if webhook is subscribed to the specific event type
   - Integrate via existing `workspaceWebhookService.js`

8. **Comment Pinning**
   - Allow workspace admins to pin up to 5 comments per task
   - `POST /workspaces/:id/tasks/:taskId/comments/:commentId/pin`
   - `DELETE /workspaces/:id/tasks/:taskId/comments/:commentId/pin`
   - Pinned comments always appear first in list

---

## Rules to Carry Forward

All rules from `AI_PROTOCOL_V161.md` remain in effect:
- **R1**: Sacred files immutable — verify MD5 before packaging
- **R2**: Endpoint tags `[V162-T01]` … ascending
- **R3**: Full canonical ZIP — all files including `apps/web/`
- **R4**: No renumbering prior endpoints
- **R5**: All prior tests must pass
- **R6**: Zero new external dependencies
- **R7**: In-memory + DB dual persistence
- **R8**: `NODE_ENV === 'test'` export blocks
- **R9**: Handoff docs (CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL)
- **R10**: JSDoc with version tags in all new lib files
- **R11**: `apps/web/` must be present in ZIP (`find apps/web/src -name "*.jsx" | wc -l` ≥ 30)
- **R12**: Audit trail is append-only — no modify/delete in service or DB

---

## New Session Startup Checklist

1. Extract `ecos_v161_canonical.zip` to working directory
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server line count: `wc -l ecos-api-server.js` → should be 11,733
4. Confirm test count: `ls tests/*.test.js | wc -l` and spot-run `node tests/v161Labels.test.js`
5. Confirm apps/web: `find apps/web/src -name "*.jsx" | wc -l` → ≥ 30
6. Confirm `package.json` version is `"161.0.0"`
7. Begin V162 implementation per P51 candidates above

---

## File Manifest (V161 canonical)

**Key files added/changed in V161:**
```
lib/workspaceLabelsService.js       ← NEW
lib/workspaceTaskCommentService.js  ← NEW
lib/workspaceTaskSlaService.js      ← NEW
lib/workspaceAuditTrailService.js   ← NEW
db/migration_phase35.sql            ← NEW
tests/v161Labels.test.js            ← NEW (21 tests)
tests/v161Comments.test.js          ← NEW (22 tests)
tests/v161SlaAudit.test.js          ← NEW (23 tests)
ecos-api-server.js                  ← MODIFIED (+539 lines, V161 block appended)
package.json                        ← MODIFIED (version: 160.0.0 → 161.0.0)
apps/web/                           ← RESTORED (was missing in V160)
CHANGELOG_V161.md                   ← NEW
AI_PROTOCOL_V161.md                 ← NEW
NEXT_SESSION_PROMPT_V161.md         ← THIS FILE
```

**Sacred files (unchanged):**
```
lib/fiatLedger.js  MD5: 563e9b1f9e67091a5b6527c0a92568e5
lib/auditLog.js    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb
```
