# Next Session Prompt — V167 → V168

## Context Summary

**Current version:** V167 (Phase P56 COMPLETE)
**Server:** `ecos-api-server.js` — 12,578 lines
**Cumulative tests:** ≥2,056 (V167: +35 new; all passing ✓)
**DB Migrations:** Phase 41 applied (1 new table + 3 new indexes)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

---

## V167 Deliverables Completed

### New Lib Modules
- `lib/workspaceActivityFeedService.js` — paginated activity feed, cursor pagination, type/actor/date filters, WebSocket real-time fan-out, in-memory circular buffer (500/ws), DB dual persistence

### DB — Phase 41
- `workspace_activity_feed` — activity event records per workspace (+ 3 indexes)

### API Endpoints (5 — V167-T01 … V167-T05)
- Block A: Workspace Activity Feed CRUD (T01–T04)
- Block B: Admin summary V167 (T05)

### Tests
- `tests/v167.test.js` — 35 tests ✓ PASS

---

## Cumulative State at V167

| Metric | Value |
|---|---|
| Server lines | 12,578 |
| Total endpoints | 180 |
| Cumulative tests | ≥2,056 |
| DB migration phase | 41 |
| Total lib modules | ~54 |

---

## V168 Candidates — Phase P57

### P1 (Highest Value)

1. **Custom Field Bulk Update** — set field values on multiple tasks in one request
   - `POST /workspaces/:id/custom-fields/:fieldId/bulk-set`
   - Validate values per field type, return per-task success/failure
   - Atomic within a transaction, partial-failure reporting

2. **Validator Performance Dashboard** — combined SLA + time tracking stats per validator
   - `GET /workspaces/:id/validators/:validatorId/performance`
   - Metrics: tasks completed, avg resolution time, SLA breach rate

### P2
3. **Task Recurrence Rules** — define repeating tasks with RRULE-like spec
4. **Activity Feed Subscriptions** — webhook push for activity feed events (extends V167)

---

## Rules to Carry Forward

- **R1**: Sacred files immutable — verify MD5 before packaging
- **R2**: Endpoint tags `[V168-T01]` … ascending
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

1. Extract `ecos_v167_canonical.zip`
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server: `wc -l ecos-api-server.js` → ~12,578
4. Confirm version: `grep '"version"' package.json` → `"167.0.0"`
5. Run V167 tests: `NODE_ENV=test node tests/v167.test.js` → 35 PASS
6. Begin V168 per P57 candidates above
