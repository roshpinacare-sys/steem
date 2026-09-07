# Next Session Prompt — V171 → V172

## Context Summary

**Current version:** V171 (Phase P60 COMPLETE)
**Server:** `ecos-api-server.js` — 13,603 lines
**Cumulative tests:** ≥2,222 (V171: +40 new; all passing ✓)
**DB Migrations:** Phase 45 applied (1 new table + 6 new indexes)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

---

## V171 Deliverables Completed

### New Lib Modules
- `lib/workspaceNotificationService.js` — in-app notification center per user (create/list/markRead/markAllRead/delete, unreadCount, type enum, per-user 500-notif limit)

### Existing Lib Used (no changes)
- `lib/taskDependencyService.js` — REST endpoints added on top (V171-T01…T04)

### DB — Phase 45
- `workspace_notifications` — notification records per user per workspace (+ 6 indexes)

### API Endpoints (10 — V171-T01 … V171-T10)
- Block A: Task Dependencies REST (T01–T04)
- Block B: Workspace Notifications Center (T05–T09)
- Block C: Admin summary V171 (T10)

### Tests
- `tests/v171.test.js` — 40 tests ✓ PASS

---

## Cumulative State at V171

| Metric | Value |
|---|---|
| Server lines | 13,603 |
| Total endpoints | 211 |
| Cumulative tests | ≥2,222 |
| DB migration phase | 45 |
| Total lib modules | ~61 |

---

## V172 Candidates — Phase P61

### P1 (Highest Value)

1. **Task Comments** — threaded comments on workspace tasks
   - `POST /workspaces/:id/tasks/:taskId/comments`
   - `GET  /workspaces/:id/tasks/:taskId/comments`
   - `PATCH /workspaces/:id/tasks/:taskId/comments/:commentId`
   - `DELETE /workspaces/:id/tasks/:taskId/comments/:commentId`
   - Mentions support in comment body (e.g. @userId)

2. **Workspace Search** — full-text search across tasks/tags/comments
   - `GET /workspaces/:id/search?q=...&types=tasks,tags,comments`
   - Pagination support
   - Result type discrimination

### P2
3. **Task Watchers** — subscribe to task updates
4. **Notification Webhooks** — push notifications to external URLs on workspace events

---

## Rules to Carry Forward

- **R1**: Sacred files immutable — verify MD5 before packaging
- **R2**: Endpoint tags `[V172-T01]` … ascending
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

1. Extract `ecos_v171_canonical.zip`
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server: `wc -l ecos-api-server.js` → ~13,603
4. Confirm version: `grep '"version"' package.json` → `"171.0.0"`
5. Run V171 tests: `NODE_ENV=test node tests/v171.test.js` → 40 PASS
6. Begin V172 per P61 candidates above
