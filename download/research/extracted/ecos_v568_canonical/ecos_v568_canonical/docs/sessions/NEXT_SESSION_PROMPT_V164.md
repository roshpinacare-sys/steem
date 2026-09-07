# Next Session Prompt — V164 → V165

## Context Summary

**Current version:** V164 (Phase P53 COMPLETE)
**Server:** `ecos-api-server.js` — 12,424 lines
**Cumulative tests:** ≥1,958 (V164: +40 new; all passing ✓)
**DB Migrations:** Phase 38 applied (1 new table + 1 new index)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

---

## V164 Deliverables Completed

### New Lib Modules
- `lib/workspaceCommentMentionService.js` — parse @userId mentions, record, list by comment/user, mark notified

### DB — Phase 38
- `workspace_comment_mentions` — mention records per comment
- `idx_wtl_workspace_label` — fast AND multi-label filter index

### API Endpoints (8 — V164-T01 … V164-T08)
- Block A: Comment Mentions (T01–T05)
- Block B: Enhanced Label Filtering (T06–T07)
- Block C: Admin (T08)

### Tests
- `tests/v164.test.js` — 40 tests ✓ PASS

---

## Cumulative State at V164

| Metric | Value |
|---|---|
| Server lines | 12,424 |
| Total endpoints | 161 |
| Cumulative tests | ≥1,958 |
| DB migration phase | 38 |
| Total lib modules | ~51 |

---

## V165 Candidates — Phase P54

### P1 (Highest Value)

1. **Audit Trail Webhook Push** (`extend workspaceAuditTrailService.js`)
   - Push audit events to subscribed webhooks (`event_type='audit.*'`)
   - Filter by subscription type
   - Integrate with existing `workspaceWebhookService.js`

2. **Task Custom Fields** (`lib/workspaceTaskCustomFieldService.js`)
   - Define custom field schemas per workspace (text, number, date, select)
   - Set/get custom field values per task
   - Filter tasks by custom field value

### P2
3. **Workspace Activity Feed** — stream of all events (tasks, comments, SLA, bulk ops)
4. **Validator Performance Dashboard** — combined SLA + time tracking stats per validator

---

## Rules to Carry Forward

- **R1**: Sacred files immutable — verify MD5 before packaging
- **R2**: Endpoint tags `[V165-T01]` … ascending
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

1. Extract `ecos_v164_canonical.zip`
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server: `wc -l ecos-api-server.js` → ~12,424
4. Confirm version: `grep '"version"' package.json` → `"164.0.0"`
5. Begin V165 per P54 candidates above
