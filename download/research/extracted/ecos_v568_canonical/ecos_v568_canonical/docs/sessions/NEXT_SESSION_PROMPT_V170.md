# Next Session Prompt — V170 → V171

## Context Summary

**Current version:** V170 (Phase P59 COMPLETE)
**Server:** `ecos-api-server.js` — 13,381 lines
**Cumulative tests:** ≥2,182 (V170: +41 new; all passing ✓)
**DB Migrations:** Phase 44 applied (3 new tables + 7 new indexes)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

---

## V170 Deliverables Completed

### New Lib Modules
- `lib/workspaceTagService.js` — workspace tags (create/list/delete, attach/detach to tasks, filter tasks by tag, max 200 tags/ws, 20 tags/task)
- `lib/bulkTaskStatusService.js` — bulk task status update (up to 100 tasks, 207 partial, previousStatus tracking)

### DB — Phase 44
- `workspace_tags` — tag catalog per workspace (+ 2 indexes)
- `workspace_task_tags` — many-to-many task ↔ tag attachments (+ 3 indexes)
- `workspace_task_statuses` — current status per task (+ 2 indexes)

### API Endpoints (8 — V170-T01 … V170-T08)
- Block A: Workspace Tags (T01–T05)
- Block B: Bulk Task Status Update (T06–T07)
- Block C: Admin summary V170 (T08)

### Tests
- `tests/v170.test.js` — 41 tests ✓ PASS

---

## Cumulative State at V170

| Metric | Value |
|---|---|
| Server lines | 13,381 |
| Total endpoints | 201 |
| Cumulative tests | ≥2,182 |
| DB migration phase | 44 |
| Total lib modules | ~60 |

---

## V171 Candidates — Phase P60

### P1 (Highest Value)

1. **Task Dependencies** — define prerequisite tasks; block completion until deps done
   - `POST /workspaces/:id/tasks/:taskId/dependencies`
   - `GET  /workspaces/:id/tasks/:taskId/dependencies`
   - `DELETE /workspaces/:id/tasks/:taskId/dependencies/:depId`
   - Circular dependency detection
   - `isBlocked(taskId)` → boolean

2. **Workspace Notifications** — in-app notification center per user
   - `POST /workspaces/:id/notifications` (create notification for user)
   - `GET  /workspaces/:id/notifications` (list for calling user; unread count)
   - `PATCH /workspaces/:id/notifications/:notifId/read`
   - `DELETE /workspaces/:id/notifications/:notifId`

### P2
3. **Task Comments** — threaded comments on tasks with reactions
4. **Workspace Search** — full-text search across tasks/tags/comments

---

## Rules to Carry Forward

- **R1**: Sacred files immutable — verify MD5 before packaging
- **R2**: Endpoint tags `[V171-T01]` … ascending
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

1. Extract `ecos_v170_canonical.zip`
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server: `wc -l ecos-api-server.js` → ~13,381
4. Confirm version: `grep '"version"' package.json` → `"170.0.0"`
5. Run V170 tests: `NODE_ENV=test node tests/v170.test.js` → 41 PASS
6. Begin V171 per P60 candidates above
