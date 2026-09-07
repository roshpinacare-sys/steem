# CHANGELOG — V165

## Version: 165.0.0 | Phase: P54 | Date: 2026-05-30

---

## Summary

V165 implements **P1 high-value features** from the V164 roadmap:
1. **Task Custom Fields** — define field schemas per workspace (text, number, date, select), set/get values per task, filter tasks by field value

---

## New Lib Modules (1)

| File | Lines | Purpose |
|---|---|---|
| `lib/workspaceTaskCustomFieldService.js` | ~330 | Custom field schemas + per-task values + filtering |

---

## New DB Migration

**Phase 39** (`db/migration_phase39.sql`) — 2 new tables + 3 new indexes:
- `workspace_custom_fields` — field schema definitions per workspace
- `workspace_task_custom_values` — field values per task (upsert with UNIQUE constraint)
- `idx_wcf_workspace` — fast field listing per workspace
- `idx_wtcv_workspace_task` — fast value retrieval per task
- `idx_wtcv_workspace_field_value` — fast task filtering by field+value

---

## New API Endpoints (7) — V165-T01 … V165-T07

### Block A — Task Custom Fields (T01–T06)
| Tag | Method | Path |
|---|---|---|
| V165-T01 | POST | `/api/v1/workspaces/:id/custom-fields` |
| V165-T02 | GET | `/api/v1/workspaces/:id/custom-fields` |
| V165-T03 | DELETE | `/api/v1/workspaces/:id/custom-fields/:fieldId` |
| V165-T04 | PUT | `/api/v1/workspaces/:id/tasks/:taskId/custom-fields/:fieldId` |
| V165-T05 | GET | `/api/v1/workspaces/:id/tasks/:taskId/custom-fields` |
| V165-T06 | GET | `/api/v1/workspaces/:id/custom-fields/:fieldId/tasks` |

### Block B — Admin (T07)
| Tag | Method | Path |
|---|---|---|
| V165-T07 | GET | `/api/v1/admin/system/summary/v165` |

---

## Feature Details

### Task Custom Fields
- `createField(workspaceId, { name, type, options, required })` → `CustomFieldSchema`
- Types: `text`, `number`, `date`, `select`
- `select` type: validates value against allowed options array
- `number` type: rejects non-numeric values
- `date` type: validates ISO date strings
- `required` flag enforces non-null values
- `listFields(workspaceId)` → `{ fields, count }`
- `deleteField(workspaceId, fieldId)` → idempotent, cascades values
- `setValue(workspaceId, taskId, fieldId, value)` → upsert
- `getTaskValues(workspaceId, taskId)` → all field values for a task
- `filterTasksByFieldValue(workspaceId, fieldId, value, opts)` → `{ taskIds, count }`
- Limit: 50 custom fields per workspace (`MAX_FIELDS_PER_WORKSPACE`)
- In-memory Map + DB dual persistence (JSONB value column)

---

## Tests

| File | Tests | Status |
|---|---|---|
| `tests/v165.test.js` | 33 | ✓ PASS |
| `tests/v164.test.js` | 40 | ✓ PASS (regression) |

---

## Cumulative Metrics

| Metric | V164 | V165 |
|---|---|---|
| Server lines (`ecos-api-server.js`) | 12,424 | **12,578** |
| Total endpoints | 161 | **168** |
| Cumulative tests | ≥1,958 | **≥1,991** |
| DB migration phase | 38 | **39** |
| Total lib modules | ~51 | **~52** |

---

## Sacred Files

| File | MD5 | Status |
|---|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |

---

## Protocol Compliance

- ✓ R1 — Sacred files untouched (MD5 verified)
- ✓ R2 — Endpoint tags V165-T01…T07 monotonically increasing
- ✓ R3 — Full canonical ZIP (all dirs included)
- ✓ R4 — No prior endpoints renumbered
- ✓ R5 — All V164 tests pass
- ✓ R6 — Zero new external dependencies
- ✓ R7 — In-memory + DB dual persistence in all new services
- ✓ R8 — NODE_ENV=test export blocks in new lib files
- ✓ R9 — Handoff docs: CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL
- ✓ R10 — JSDoc blocks with version tags in all new lib files
- ✓ R12 — Audit trail append-only (unchanged)
