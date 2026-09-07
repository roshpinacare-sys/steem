# Next Session Prompt — V168 → V169

## Context Summary

**Current version:** V168 (Phase P57 COMPLETE)
**Server:** `ecos-api-server.js` — 13,008 lines
**Cumulative tests:** ≥2,099 (V168: +43 new; all passing ✓)
**DB Migrations:** Phase 42 applied (1 new table + 3 new indexes)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

---

## V168 Deliverables Completed

### New Lib Modules
- `lib/customFieldBulkUpdateService.js` — bulk-set custom field values on up to 200 tasks, per-field type validation (text/number/date/select), partial-failure reporting, HTTP 207 on partial
- `lib/validatorPerformanceDashboardService.js` — per-validator metrics: tasks_completed, avg_resolution_time, sla_breach_rate, date-range filtering, listValidators

### DB — Phase 42
- `workspace_validator_perf_snapshots` — task completion records per validator (+ 3 indexes)

### API Endpoints (6 — V168-T01 … V168-T06)
- Block A: Custom Field Bulk Update (T01–T02)
- Block B: Validator Performance Dashboard (T03–T05)
- Block C: Admin summary V168 (T06)

### Tests
- `tests/v168.test.js` — 43 tests ✓ PASS

---

## Cumulative State at V168

| Metric | Value |
|---|---|
| Server lines | 13,008 |
| Total endpoints | 186 |
| Cumulative tests | ≥2,099 |
| DB migration phase | 42 |
| Total lib modules | ~56 |

---

## V169 Candidates — Phase P58

### P1 (Highest Value)

1. **Task Recurrence Rules** — define repeating tasks with RRULE-like spec
   - `POST /workspaces/:id/tasks/:taskId/recurrence`
   - `GET  /workspaces/:id/tasks/:taskId/recurrence`
   - `DELETE /workspaces/:id/tasks/:taskId/recurrence`
   - Frequencies: daily/weekly/monthly; `interval`, `until`, `count`

2. **Activity Feed Subscriptions (Webhooks)** — push webhooks on activity feed events (extends V167)
   - `POST /workspaces/:id/activity-subscriptions`
   - `GET  /workspaces/:id/activity-subscriptions`
   - `DELETE /workspaces/:id/activity-subscriptions/:subId`
   - Filter by event type; retry on failure

### P2
3. **Workspace Tags** — tag tasks and filter by tag (multi-tag support)
4. **Bulk Task Status Update** — change status on multiple tasks in one call

---

## Rules to Carry Forward

- **R1**: Sacred files immutable — verify MD5 before packaging
- **R2**: Endpoint tags `[V169-T01]` … ascending
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

1. Extract `ecos_v168_canonical.zip`
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server: `wc -l ecos-api-server.js` → ~13,008
4. Confirm version: `grep '"version"' package.json` → `"168.0.0"`
5. Run V168 tests: `NODE_ENV=test node tests/v168.test.js` → 43 PASS
6. Begin V169 per P58 candidates above
