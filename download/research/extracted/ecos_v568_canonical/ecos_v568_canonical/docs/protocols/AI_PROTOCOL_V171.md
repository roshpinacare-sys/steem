# AI Protocol — V171

## Version: 171.0.0 | Phase: P60

**Sacred files (MUST NOT MODIFY):**
- `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5`
- `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

**New lib modules added in V171:**
- `lib/workspaceNotificationService.js` — Workspace Notifications Center (create/list/markRead/markAllRead/delete, unread count, type validation, per-user limit 500)

**Existing lib module used (no changes):**
- `lib/taskDependencyService.js` — Task Dependency Graph (V160); V171 adds REST endpoints on top

**DB Phase:** 45 (`db/migration_phase45.sql`) — `workspace_notifications` table + 6 indexes

**Endpoints added:** V171-T01…V171-T10 (10 endpoints; total ≥211)

**Tests:** `tests/v171.test.js` — 40 tests ✓ PASS
