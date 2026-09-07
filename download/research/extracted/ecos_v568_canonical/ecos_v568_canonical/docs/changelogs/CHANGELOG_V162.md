# CHANGELOG — V162

## Version: 162.0.0 | Phase: P51 | Date: 2026-05-30

---

## Summary

V162 implements the three **P1 high-value services** from the V161 roadmap:
1. **Task Recurrence Scheduling** — daily / weekly / monthly rules with auto-spawn
2. **Workspace Bulk Operations** — status / assign / delete up to 500 tasks at once
3. **Task Time Tracking** — start/stop timer + manual log + leaderboard

---

## New Lib Modules (3)

| File | Lines | Purpose |
|---|---|---|
| `lib/workspaceTaskRecurrenceService.js` | ~220 | Recurrence rules + spawn |
| `lib/workspaceBulkOpsService.js` | ~220 | Bulk status/assign/delete |
| `lib/workspaceTimeTrackingService.js` | ~260 | Timer + manual log + leaderboard |

---

## New DB Migration

**Phase 36** (`db/migration_phase36.sql`) — 4 new tables + 1 column:
- `recurrence_rules` — recurring task configs
- `recurrence_instances` — spawned child task log
- `bulk_ops_log` — audit log of bulk operations
- `workspace_time_entries` — time tracking entries
- `workspace_tasks.recurrence_rule` column (ALTER TABLE)

---

## New API Endpoints (15) — V162-T01 … V162-T15

### Block A — Task Recurrence (T01–T05)
| Tag | Method | Path |
|---|---|---|
| V162-T01 | POST | `/api/v1/workspaces/:id/tasks/:taskId/recurrence` |
| V162-T02 | DELETE | `/api/v1/workspaces/:id/tasks/:taskId/recurrence` |
| V162-T03 | GET | `/api/v1/workspaces/:id/tasks/recurring` |
| V162-T04 | POST | `/api/v1/workspaces/:id/tasks/:taskId/recurrence/spawn` |
| V162-T05 | GET | `/api/v1/workspaces/:id/recurrence/stats` |

### Block B — Bulk Operations (T06–T09)
| Tag | Method | Path |
|---|---|---|
| V162-T06 | POST | `/api/v1/workspaces/:id/tasks/bulk-status` |
| V162-T07 | POST | `/api/v1/workspaces/:id/tasks/bulk-assign` |
| V162-T08 | DELETE | `/api/v1/workspaces/:id/tasks/bulk-delete` |
| V162-T09 | GET | `/api/v1/workspaces/:id/bulk-ops/stats` |

### Block C — Time Tracking (T10–T14)
| Tag | Method | Path |
|---|---|---|
| V162-T10 | POST | `/api/v1/workspaces/:id/tasks/:taskId/time/start` |
| V162-T11 | POST | `/api/v1/workspaces/:id/tasks/:taskId/time/stop` |
| V162-T12 | POST | `/api/v1/workspaces/:id/tasks/:taskId/time/log` |
| V162-T13 | GET | `/api/v1/workspaces/:id/tasks/:taskId/time/summary` |
| V162-T14 | GET | `/api/v1/workspaces/:id/time/leaderboard` |

### Block D — Admin (T15)
| Tag | Method | Path |
|---|---|---|
| V162-T15 | GET | `/api/v1/admin/system/summary/v162` |

---

## Tests

| File | Tests | Status |
|---|---|---|
| `tests/v162.test.js` | 66 | ✓ PASS |
| `tests/v161Labels.test.js` | 21 | ✓ PASS (regression) |
| `tests/v161Comments.test.js` | 22 | ✓ PASS (regression) |
| `tests/v161SlaAudit.test.js` | 23 | ✓ PASS (regression) |

---

## Cumulative Metrics

| Metric | V161 | V162 |
|---|---|---|
| Server lines (`ecos-api-server.js`) | 11,733 | 12,004 |
| Total endpoints | 130 | **145** |
| Cumulative tests | ≥1,812 | **≥1,878** |
| DB migration phase | 35 | **36** |
| Total lib modules | ~45 | **~48** |
| apps/web JSX files | 29 | **30** |

---

## Sacred Files

| File | MD5 | Status |
|---|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |

---

## Protocol Compliance

- ✓ R1 — Sacred files untouched (MD5 verified)
- ✓ R2 — Endpoint tags V162-T01…T15 monotonically increasing
- ✓ R3 — Full canonical ZIP (all dirs included)
- ✓ R4 — No prior endpoints renumbered
- ✓ R5 — All V161 tests pass (66 tests)
- ✓ R6 — Zero new external dependencies
- ✓ R7 — In-memory + DB dual persistence in all 3 services
- ✓ R8 — NODE_ENV=test export blocks in all 3 lib files
- ✓ R9 — Handoff docs: CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL
- ✓ R10 — JSDoc blocks with version tags in all new lib files
- ✓ R11 — apps/web: 30 JSX files (≥30 ✓)
- ✓ R12 — Audit trail append-only (no modify/delete methods)
