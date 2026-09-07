# Next Session Prompt — V169 → V170

## Context Summary

**Current version:** V169 (Phase P58 COMPLETE)
**Server:** `ecos-api-server.js` — 13,184 lines
**Cumulative tests:** ≥2,141 (V169: +42 new; all passing ✓)
**DB Migrations:** Phase 43 applied (2 new tables + 5 new indexes)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

---

## V169 Deliverables Completed

### New Lib Modules
- `lib/taskRecurrenceService.js` — task recurrence rules (daily/weekly/monthly, interval, until, count, nextOccurrence)
- `lib/activityFeedSubscriptionService.js` — push-webhook subscriptions for activity feed events, retry on failure

### DB — Phase 43
- `workspace_task_recurrence_rules` — recurrence rule per task (+ 3 indexes)
- `workspace_activity_subscriptions` — webhook subscriptions per workspace (+ 2 indexes)

### API Endpoints (7 — V169-T01 … V169-T07)
- Block A: Task Recurrence Rules (T01–T03)
- Block B: Activity Feed Subscriptions (T04–T06)
- Block C: Admin summary V169 (T07)

### Tests
- `tests/v169.test.js` — 42 tests ✓ PASS

---

## Cumulative State at V169

| Metric | Value |
|---|---|
| Server lines | 13,184 |
| Total endpoints | 193 |
| Cumulative tests | ≥2,141 |
| DB migration phase | 43 |
| Total lib modules | ~58 |

---

## V170 Candidates — Phase P59

### P1 (Highest Value)

1. **Workspace Tags** — tag tasks and filter by tag (multi-tag support)
   - `POST /workspaces/:id/tags`
   - `GET  /workspaces/:id/tags`
   - `POST /workspaces/:id/tasks/:taskId/tags`
   - `GET  /workspaces/:id/tasks/:taskId/tags`
   - `DELETE /workspaces/:id/tasks/:taskId/tags/:tagId`

2. **Bulk Task Status Update** — change status on multiple tasks in one call
   - `POST /workspaces/:id/tasks/bulk-status`
   - Body: `{ taskIds: string[], status: string }`
   - Returns 207 on partial failure

### P2
3. **Task Dependencies** — define prerequisite tasks, block completion until deps done
4. **Workspace Notifications** — in-app notification center per user

---

## Rules to Carry Forward

- **R1**: Sacred files immutable — verify MD5 before packaging
- **R2**: Endpoint tags `[V170-T01]` … ascending
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

1. Extract `ecos_v169_canonical.zip`
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server: `wc -l ecos-api-server.js` → ~13,184
4. Confirm version: `grep '"version"' package.json` → `"169.0.0"`
5. Run V169 tests: `NODE_ENV=test node tests/v169.test.js` → 42 PASS
6. Begin V170 per P59 candidates above
