# CHANGELOG — V163

## Version: 163.0.0 | Phase: P52 | Date: 2026-05-30

---

## Summary

V163 implements **P2 high-value features** from the V162 roadmap:
1. **Comment Pinning** — pin/unpin up to 5 comments per task, pinned first in listings
2. **SLA Report by Assignee** — breach counts per validator, ranked worst-first

---

## New Lib Modules (2)

| File | Lines | Purpose |
|---|---|---|
| `lib/workspaceCommentPinService.js` | ~130 | Pin/unpin comments, max-5 enforcement |
| `lib/workspaceSlaAssigneeReportService.js` | ~100 | SLA breach tracking + ranked report |

---

## New DB Migration

**Phase 37** (`db/migration_phase37.sql`) — 2 new tables:
- `workspace_pinned_comments` — pinned comment records per task
- `workspace_sla_assignee_events` — SLA event log per assignee

---

## New API Endpoints (8) — V163-T01 … V163-T08

### Block A — Comment Pinning (T01–T04)
| Tag | Method | Path |
|---|---|---|
| V163-T01 | POST | `/api/v1/workspaces/:id/tasks/:taskId/comments/:commentId/pin` |
| V163-T02 | DELETE | `/api/v1/workspaces/:id/tasks/:taskId/comments/:commentId/pin` |
| V163-T03 | GET | `/api/v1/workspaces/:id/tasks/:taskId/comments/pinned` |
| V163-T04 | GET | `/api/v1/workspaces/:id/tasks/:taskId/comments/pinned/stats` |

### Block B — SLA Assignee Report (T05–T07)
| Tag | Method | Path |
|---|---|---|
| V163-T05 | GET | `/api/v1/workspaces/:id/sla/report/by-assignee` |
| V163-T06 | POST | `/api/v1/workspaces/:id/sla/assignee-event` |
| V163-T07 | GET | `/api/v1/workspaces/:id/sla/assignee-stats` |

### Block C — Admin (T08)
| Tag | Method | Path |
|---|---|---|
| V163-T08 | GET | `/api/v1/admin/system/summary/v163` |

---

## Tests

| File | Tests | Status |
|---|---|---|
| `tests/v163.test.js` | 40 | ✓ PASS |
| `tests/v162.test.js` | 66 | ✓ PASS (regression) |

---

## Cumulative Metrics

| Metric | V162 | V163 |
|---|---|---|
| Server lines (`ecos-api-server.js`) | 12,004 | **12,161** |
| Total endpoints | 145 | **153** |
| Cumulative tests | ≥1,878 | **≥1,918** |
| DB migration phase | 36 | **37** |
| Total lib modules | ~48 | **~50** |

---

## Sacred Files

| File | MD5 | Status |
|---|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |

---

## Protocol Compliance

- ✓ R1 — Sacred files untouched (MD5 verified)
- ✓ R2 — Endpoint tags V163-T01…T08 monotonically increasing
- ✓ R3 — Full canonical ZIP (all dirs included)
- ✓ R4 — No prior endpoints renumbered
- ✓ R5 — All V162 tests pass
- ✓ R6 — Zero new external dependencies
- ✓ R7 — In-memory + DB dual persistence in all new services
- ✓ R8 — NODE_ENV=test export blocks in all new lib files
- ✓ R9 — Handoff docs: CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL
- ✓ R10 — JSDoc blocks with version tags in all new lib files
- ✓ R12 — Audit trail append-only (unchanged)
