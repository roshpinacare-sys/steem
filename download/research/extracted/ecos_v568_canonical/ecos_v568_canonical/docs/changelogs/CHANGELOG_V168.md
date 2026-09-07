# CHANGELOG — V168

## Version: 168.0.0 | Phase: P57 | Date: 2026-05-30

---

## Summary

V168 implements **P1 high-value features** from the V167 roadmap:
1. **Custom Field Bulk Update** — set a custom field value on multiple tasks in one request, with per-task success/failure reporting and full type validation
2. **Validator Performance Dashboard** — combined SLA + time-tracking metrics per validator with date-range filtering

---

## New Lib Modules (2)

| File | Lines | Purpose |
|---|---|---|
| `lib/customFieldBulkUpdateService.js` | ~230 | Bulk-set custom field values on multiple tasks, type validation, partial-failure reporting |
| `lib/validatorPerformanceDashboardService.js` | ~260 | Per-validator performance metrics: tasks completed, avg resolution time, SLA breach rate |

---

## New DB Migration

**Phase 42** (`db/migration_phase42.sql`) — 1 new table + 3 new indexes:
- `workspace_validator_perf_snapshots` — task completion records per validator
- `idx_wvps_workspace_validator_completed` — fast listing per workspace+validator by recency
- `idx_wvps_workspace_completed` — cross-validator analytics
- `idx_wvps_workspace_validator_sla` — SLA breach filtering

---

## New API Endpoints (6) — V168-T01 … V168-T06

### Block A — Custom Field Bulk Update (T01–T02)
| Tag | Method | Path |
|---|---|---|
| V168-T01 | POST | `/api/v1/workspaces/:id/custom-fields/:fieldId/bulk-set` |
| V168-T02 | GET  | `/api/v1/workspaces/:id/tasks/:taskId/custom-fields/:fieldId` |

### Block B — Validator Performance Dashboard (T03–T05)
| Tag | Method | Path |
|---|---|---|
| V168-T03 | GET  | `/api/v1/workspaces/:id/validators/:validatorId/performance` |
| V168-T04 | POST | `/api/v1/workspaces/:id/validators/:validatorId/performance/record` |
| V168-T05 | GET  | `/api/v1/workspaces/:id/validators` |

### Block C — Admin (T06)
| Tag | Method | Path |
|---|---|---|
| V168-T06 | GET | `/api/v1/admin/system/summary/v168` |

---

## Feature Details

### Custom Field Bulk Update
- `bulkSetField(workspaceId, fieldId, taskIds, value)` → `{ results, totalOk, totalFailed }`
  - `taskIds` — up to 200 tasks per request
  - Type validation per field schema: `text`, `number`, `date`, `select`
  - `select` fields: value must be one of defined options
  - Per-task `BulkUpdateResult` — `{ taskId, ok, error, value }`
  - Returns HTTP 207 on partial failure
  - Atomic in-memory + DB dual persistence
- `getFieldValue(workspaceId, taskId, fieldId)` → stored value entry or null

### Validator Performance Dashboard
- `recordCompletion(workspaceId, validatorId, data)` → `TaskRecord`
  - Fields: `taskId`, `resolutionMs`, `slaBreached`, `completedAt`
- `getPerformance(workspaceId, validatorId, opts)` → `ValidatorPerfSummary`
  - Metrics: `tasksCompleted`, `avgResolutionMs`, `avgResolutionHours`, `slaBreachRate`, `slaBreachCount`
  - Date range: `since` / `until` (default: last 30 days)
- `listValidators(workspaceId)` → `string[]`

---

## Tests

| File | Tests | Status |
|---|---|---|
| `tests/v168.test.js` | 43 | ✓ PASS |
| `tests/v167.test.js` | 35 | ✓ PASS (regression) |

---

## Cumulative Metrics

| Metric | V167 | V168 |
|---|---|---|
| Server lines (`ecos-api-server.js`) | 12,578 | **13,008** |
| Total endpoints | 180 | **186** |
| Cumulative tests | ≥2,056 | **≥2,099** |
| DB migration phase | 41 | **42** |
| Total lib modules | ~54 | **~56** |

---

## Sacred Files

| File | MD5 | Status |
|---|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |

---

## Protocol Compliance

- ✓ R1 — Sacred files untouched (MD5 verified)
- ✓ R2 — Endpoint tags V168-T01…T06 monotonically increasing
- ✓ R3 — Full canonical ZIP (all dirs included)
- ✓ R4 — No prior endpoints renumbered
- ✓ R5 — All V167 tests pass
- ✓ R6 — Zero new external dependencies
- ✓ R7 — In-memory + DB dual persistence in new service files
- ✓ R8 — NODE_ENV=test export blocks in new lib files
- ✓ R9 — Handoff docs: CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL
- ✓ R10 — JSDoc blocks with version tags in all new lib files
- ✓ R12 — Audit trail append-only (unchanged)
