# AI Protocol — V170

## Version: 170.0.0 | Phase: P59

**Sacred files (MUST NOT MODIFY):**
- `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5`
- `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

**New lib modules added in V170:**
- `lib/workspaceTagService.js` — Workspace Tags (create/list/delete, attach/detach to tasks, filter by tag)
- `lib/bulkTaskStatusService.js` — Bulk Task Status Update (multi-task status change, 207 partial)

**DB Phase:** 44 (`db/migration_phase44.sql`)

**Endpoints added:** V170-T01…V170-T08 (8 endpoints; total ≥201)

**Tests:** `tests/v170.test.js` — 41 tests ✓ PASS
