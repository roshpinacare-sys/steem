# Next Session Prompt — V162 → V163

## Context Summary

**Current version:** V162 (Phase P51 COMPLETE)
**Server:** `ecos-api-server.js` — 12,004 lines
**Cumulative tests:** ≥1,878 (V162: +66 new; all passing ✓)
**DB Migrations:** Phase 36 applied (4 new tables + 1 column)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`
**apps/web:** 30 JSX files ✓

---

## V162 Deliverables Completed

### New Lib Modules
- `lib/workspaceTaskRecurrenceService.js` — daily/weekly/monthly recurrence rules + auto-spawn (~220 lines)
- `lib/workspaceBulkOpsService.js` — bulk status/assign/delete up to 500 tasks, per-task result array (~220 lines)
- `lib/workspaceTimeTrackingService.js` — startTimer/stopTimer/logManual + leaderboard + per-task total (~260 lines)

### DB — Phase 36 (4 tables + 1 column)
`recurrence_rules`, `recurrence_instances`, `bulk_ops_log`, `workspace_time_entries`
+ `workspace_tasks.recurrence_rule TEXT` column

### API Endpoints (15 tasks — V162-T01 … V162-T15)
- Block A: Recurrence (T01–T05) — set/delete/list/spawn/stats
- Block B: Bulk Ops (T06–T09) — status/assign/delete/stats
- Block C: Time Tracking (T10–T14) — start/stop/log/summary/leaderboard
- Block D: Admin (T15) — summary/v162

### Tests
- `tests/v162.test.js` — 66 tests ✓ PASS

---

## Cumulative State at V162

| Metric | Value |
|---|---|
| Server lines (`ecos-api-server.js`) | 12,004 |
| Total endpoints | 145 |
| Cumulative tests | ≥1,878 |
| DB migration phase | 36 |
| Total lib modules | ~48 |
| apps/web frontend | ✓ Present (30 JSX files) |

---

## V163 Candidates — Phase P52

### P1 (Critical / Highest Value)

1. **Comment Mentions + Notifications** (extend `workspaceTaskCommentService.js`)
   - Parse `@userId` mentions in comment body
   - Emit notification via existing `notificationService` for each mentioned user
   - Endpoint: `GET /workspaces/:id/tasks/:taskId/comments/:commentId/mentions`

2. **Enhanced Label Filtering on Task List**
   - Extend `GET /workspaces/:id/tasks` to accept `?labelId[]=` query param
   - AND logic: returns only tasks with ALL specified labels
   - No new lib needed — extend `workspaceTaskService.js`

3. **SLA Report by Assignee**
   - `GET /workspaces/:id/sla/report/by-assignee` — breach counts per validator
   - Uses in-memory SLA events + task assignee data
   - Returns ranked list: worst-performing assignees first

### P2 (High Value)

4. **Audit Trail Webhook Push**
   - When audit event recorded, push to all `workspace_webhooks` with `event_type === 'audit.*'`
   - Integrate via existing `workspaceWebhookService.js`

5. **Comment Pinning**
   - Allow workspace admins to pin up to 5 comments per task
   - `POST/DELETE /workspaces/:id/tasks/:taskId/comments/:commentId/pin`

6. **Recurrence Pause/Resume**
   - `POST /workspaces/:id/tasks/:taskId/recurrence/pause`
   - `POST /workspaces/:id/tasks/:taskId/recurrence/resume`
   - Sets `enabled=false/true` on rule

7. **Time Tracking by Date Range**
   - `GET /workspaces/:id/time/entries?from=&to=&userId=`
   - Extend `listEntries` with date-range filtering

---

## New Session Startup Checklist

1. Extract `ecos_v162_canonical.zip` to working directory
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server line count: `wc -l ecos-api-server.js` → should be ~12,004
4. Confirm apps/web: `find apps/web/src -name "*.jsx" | wc -l` → ≥ 30
5. Spot-run: `node tests/v162.test.js` → 66 passed
6. Confirm `package.json` version is `"162.0.0"`
7. Begin V163 implementation per P52 candidates above

---

## File Manifest (V162 canonical)

**Key files added/changed in V162:**
```
lib/workspaceTaskRecurrenceService.js  ← NEW
lib/workspaceBulkOpsService.js         ← NEW
lib/workspaceTimeTrackingService.js    ← NEW
db/migration_phase36.sql               ← NEW
tests/v162.test.js                     ← NEW (66 tests)
apps/web/src/app/time-tracking/page.jsx ← NEW
ecos-api-server.js                     ← MODIFIED (+271 lines, V162 block appended)
package.json                           ← MODIFIED (version: 161.0.0 → 162.0.0)
CHANGELOG_V162.md                      ← NEW
AI_PROTOCOL_V162.md                    ← NEW
NEXT_SESSION_PROMPT_V162.md            ← THIS FILE
```

**Sacred files (unchanged):**
```
lib/fiatLedger.js  MD5: 563e9b1f9e67091a5b6527c0a92568e5
lib/auditLog.js    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb
```
