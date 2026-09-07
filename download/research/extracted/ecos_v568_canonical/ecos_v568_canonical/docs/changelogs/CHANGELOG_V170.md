# CHANGELOG — V170

## Version: 170.0.0 | Phase: P59 | Date: 2026-05-30

---

## Summary

V170 implements **P59 high-value features** from the V169 roadmap:
1. **Workspace Tags** — create/list/delete tags per workspace; attach/detach tags to tasks (multi-tag); filter tasks by tag
2. **Bulk Task Status Update** — change status on multiple tasks in one call; 207 Multi-Status on partial failure

---

## New Lib Modules (2)

| File | Lines | Purpose |
|---|---|---|
| `lib/workspaceTagService.js` | ~310 | Workspace tags: create/list/delete tags, attach/detach to tasks, list tasks by tag |
| `lib/bulkTaskStatusService.js` | ~140 | Bulk task status: update multiple tasks at once, 207 on partial failure |

---

## New DB Migration

**Phase 44** (`db/migration_phase44.sql`) — 3 new tables + 7 new indexes:
- `workspace_tags` — one row per tag per workspace (unique name per workspace)
  - `idx_wt_workspace`
  - `idx_wt_workspace_name`
- `workspace_task_tags` — many-to-many task ↔ tag attachments
  - `idx_wtt_workspace_task`
  - `idx_wtt_workspace_tag`
  - `idx_wtt_tag`
- `workspace_task_statuses` — current status per task (for bulk operations)
  - `idx_wts_workspace_status`

---

## New API Endpoints (8) — V170-T01 … V170-T08

### Block A — Workspace Tags (T01–T05)
| Tag | Method | Path |
|---|---|---|
| V170-T01 | POST   | `/api/v1/workspaces/:workspaceId/tags` |
| V170-T02 | GET    | `/api/v1/workspaces/:workspaceId/tags` |
| V170-T03 | POST   | `/api/v1/workspaces/:workspaceId/tasks/:taskId/tags` |
| V170-T04 | GET    | `/api/v1/workspaces/:workspaceId/tasks/:taskId/tags` |
| V170-T05 | DELETE | `/api/v1/workspaces/:workspaceId/tasks/:taskId/tags/:tagId` |

### Block B — Bulk Task Status Update (T06–T07)
| Tag | Method | Path |
|---|---|---|
| V170-T06 | POST | `/api/v1/workspaces/:workspaceId/tasks/bulk-status` |
| V170-T07 | GET  | `/api/v1/workspaces/:workspaceId/tasks/bulk-status/schema` |

### Block C — Admin (T08)
| Tag | Method | Path |
|---|---|---|
| V170-T08 | GET | `/api/v1/admin/system/summary/v170` |

---

## Feature Details

### Workspace Tags
- `createTag(workspaceId, opts)` → `WorkspaceTag`
  - `name` required (≤64 chars, trimmed, unique per workspace case-insensitive)
  - `color` optional hex string e.g. `#ff5733`
  - Max 200 tags per workspace (`TAG_LIMIT_REACHED` 429)
- `listTags(workspaceId)` → `WorkspaceTag[]`
- `getTag(workspaceId, tagId)` → `WorkspaceTag` (404 if absent)
- `deleteTag(workspaceId, tagId)` → `{ deleted, tagId, attachmentsRemoved }` — cascades to remove all task attachments
- `attachTag(workspaceId, taskId, tagId)` → `TaskTagAttachment`
  - Max 20 tags per task (`TAG_LIMIT_REACHED` 429)
  - 409 if already attached (`TAG_ALREADY_ATTACHED`)
- `listTaskTags(workspaceId, taskId)` → `WorkspaceTag[]`
- `detachTag(workspaceId, taskId, tagId)` → `{ deleted, taskId, tagId }`
- `listTasksByTag(workspaceId, tagId)` → `string[]` (taskIds)

### Bulk Task Status Update
- `bulkUpdateStatus(workspaceId, taskIds, status)` → `BulkStatusResult`
  - Valid statuses: `open` | `in_progress` | `done` | `blocked` | `cancelled`
  - Max 100 tasks per call
  - Returns HTTP 200 on full success, 207 on partial failure, 400 on total failure
  - `BulkStatusResult`: `{ updated[], failed[], updatedCount, failedCount, totalRequested, partial, allFailed, httpStatus, processedAt }`
  - Each `updated` item includes `previousStatus` for audit trail
- `getTaskStatus(workspaceId, taskId)` → `string|null`
- `setTaskStatus(workspaceId, taskId, status)` — single task setter

---

## Tests

| File | Tests | Status |
|---|---|---|
| `tests/v170.test.js` | 41 | ✓ PASS |
| `tests/v169.test.js` | 42 | ✓ PASS (regression) |

---

## Cumulative Metrics

| Metric | V169 | V170 |
|---|---|---|
| Server lines (`ecos-api-server.js`) | 13,184 | **13,381** |
| Total endpoints | 193 | **201** |
| Cumulative tests | ≥2,141 | **≥2,182** |
| DB migration phase | 43 | **44** |
| Total lib modules | ~58 | **~60** |

---

## Sacred Files

| File | MD5 | Status |
|---|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |

---

## Protocol Compliance

- ✓ R1 — Sacred files untouched (MD5 verified)
- ✓ R2 — Endpoint tags V170-T01…T08 monotonically increasing
- ✓ R3 — Full canonical ZIP (all dirs included)
- ✓ R4 — No prior endpoints renumbered
- ✓ R5 — All V169 tests pass (regression verified)
- ✓ R6 — Zero new external dependencies
- ✓ R7 — In-memory + DB dual persistence in new service files
- ✓ R8 — NODE_ENV=test export blocks in new lib files
- ✓ R9 — Handoff docs: CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL
- ✓ R10 — JSDoc blocks with version tags in all new lib files
- ✓ R12 — Audit trail append-only (unchanged)
