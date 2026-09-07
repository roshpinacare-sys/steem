# Next Session Prompt — V165 → V166

## Context Summary

**Current version:** V165 (Phase P54 COMPLETE)
**Server:** `ecos-api-server.js` — 12,578 lines
**Cumulative tests:** ≥1,991 (V165: +33 new; all passing ✓)
**DB Migrations:** Phase 39 applied (2 new tables + 3 new indexes)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

---

## V165 Deliverables Completed

### New Lib Modules
- `lib/workspaceTaskCustomFieldService.js` — define field schemas (text/number/date/select), set/get values per task, filter tasks by field value

### DB — Phase 39
- `workspace_custom_fields` — field schema definitions per workspace
- `workspace_task_custom_values` — per-task field values (JSONB, upsert)

### API Endpoints (7 — V165-T01 … V165-T07)
- Block A: Task Custom Fields (T01–T06)
- Block B: Admin summary V165 (T07)

### Tests
- `tests/v165.test.js` — 33 tests ✓ PASS

---

## Cumulative State at V165

| Metric | Value |
|---|---|
| Server lines | 12,578 |
| Total endpoints | 168 |
| Cumulative tests | ≥1,991 |
| DB migration phase | 39 |
| Total lib modules | ~52 |

---

## V166 Candidates — Phase P55

### P1 (Highest Value)

1. **Audit Trail Webhook Push** (`extend workspaceAuditTrailService.js`)
   - Push audit events to subscribed webhooks (`event_type='audit.*'`)
   - Filter by subscription type
   - Integrate with existing `workspaceWebhookService.js`

2. **Workspace Activity Feed** — stream of all events (tasks, comments, SLA, bulk ops)
   - `GET /workspaces/:id/activity` — paginated, filterable by type/actor/date

### P2
3. **Validator Performance Dashboard** — combined SLA + time tracking stats per validator
4. **Custom Field Bulk Update** — set field values on multiple tasks in one request

---

## Rules to Carry Forward

- **R1**: Sacred files immutable — verify MD5 before packaging
- **R2**: Endpoint tags `[V166-T01]` … ascending
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

1. Extract `ecos_v165_canonical.zip`
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server: `wc -l ecos-api-server.js` → ~12,578
4. Confirm version: `grep '"version"' package.json` → `"165.0.0"`
5. Begin V166 per P55 candidates above
