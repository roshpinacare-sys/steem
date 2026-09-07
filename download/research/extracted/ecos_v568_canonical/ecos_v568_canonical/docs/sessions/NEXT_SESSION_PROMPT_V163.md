# Next Session Prompt — V163 → V164

## Context Summary

**Current version:** V163 (Phase P52 COMPLETE)
**Server:** `ecos-api-server.js` — 12,161 lines
**Cumulative tests:** ≥1,918 (V163: +40 new; all passing ✓)
**DB Migrations:** Phase 37 applied (2 new tables)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

---

## V163 Deliverables Completed

### New Lib Modules
- `lib/workspaceCommentPinService.js` — pin/unpin comments, max 5 per task, enforced limit
- `lib/workspaceSlaAssigneeReportService.js` — SLA breach aggregation per assignee, ranked report

### DB — Phase 37 (2 tables)
`workspace_pinned_comments`, `workspace_sla_assignee_events`

### API Endpoints (8 — V163-T01 … V163-T08)
- Block A: Comment Pinning (T01–T04)
- Block B: SLA Assignee Report (T05–T07)
- Block C: Admin (T08)

### Tests
- `tests/v163.test.js` — 40 tests ✓ PASS

---

## Cumulative State at V163

| Metric | Value |
|---|---|
| Server lines | 12,161 |
| Total endpoints | 153 |
| Cumulative tests | ≥1,918 |
| DB migration phase | 37 |
| Total lib modules | ~50 |

---

## V164 Candidates — Phase P53

### P1 (Highest Value)

1. **Audit Trail Webhook Push** (`extend workspaceAuditTrailService.js`)
   - Push audit events to subscribed webhooks (`event_type='audit.*'`)
   - Filter by subscription type
   - Integrate with existing `workspaceWebhookService.js`

2. **Enhanced Label Filtering** (extend `workspaceTaskService.js`)
   - `GET /workspaces/:id/tasks?labelId[]=...` — AND logic multi-label filter
   - No new lib needed

3. **Comment Mentions + Notifications** (extend `workspaceTaskCommentService.js`)
   - Parse `@userId` in comment body
   - Emit notification events per mention
   - `GET /workspaces/:id/tasks/:taskId/comments/:commentId/mentions`

4. **Task Custom Fields** (`lib/workspaceTaskCustomFieldService.js`)
   - Define custom field schemas per workspace (text, number, date, select)
   - Set/get custom field values per task
   - Filter tasks by custom field value

### P2
5. **Workspace Activity Feed** — stream of all events (tasks, comments, SLA, bulk ops)
6. **Validator Performance Dashboard** — combined SLA + time tracking stats per validator

---

## Rules to Carry Forward

- **R1**: Sacred files immutable — verify MD5 before packaging
- **R2**: Endpoint tags `[V164-T01]` … ascending
- **R3**: Full canonical ZIP
- **R4**: No renumbering prior endpoints
- **R5**: All prior tests must pass
- **R6**: Zero new external dependencies
- **R7**: In-memory + DB dual persistence
- **R8**: `NODE_ENV === 'test'` export blocks
- **R9**: Handoff docs (CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL)
- **R10**: JSDoc with version tags in all new lib files
- **R12**: Audit trail append-only

---

## New Session Startup Checklist

1. Extract `ecos_v163_canonical.zip`
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server: `wc -l ecos-api-server.js` → ~12,161
4. Confirm version: `grep '"version"' package.json` → `"163.0.0"`
5. Begin V164 per P53 candidates above
