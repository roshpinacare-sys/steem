# CHANGELOG — V161

## Version: 161.0.0 · Phase: P50 · Date: 2026-05-30

---

## Summary

V161 implements **Phase P50**: four new workspace collaboration modules — Labels, Task Comments, SLA Policies, and an immutable Audit Trail — along with 36 new API endpoints, 6 new DB tables, 66 new unit tests, and a full restoration of the `apps/web` Next.js frontend (which was missing from V160).

---

## New Lib Modules (4)

| File | Lines | Purpose |
|---|---|---|
| `lib/workspaceLabelsService.js` | 312 | Color-coded label CRUD, apply/remove per task, stats |
| `lib/workspaceTaskCommentService.js` | 336 | Threaded task comments, soft-delete, emoji reactions |
| `lib/workspaceTaskSlaService.js` | 328 | SLA policies per priority, breach detection, bulk-check |
| `lib/workspaceAuditTrailService.js` | 260 | SHA-256 chained append-only audit log |

**Total new lib lines: 1,236**

---

## Database — Phase 35 (`db/migration_phase35.sql`)

Six new tables with indexes and immutability triggers:

| Table | Purpose |
|---|---|
| `workspace_labels` | Label definitions (name, color, description) |
| `workspace_task_labels` | Many-to-many: tasks ↔ labels |
| `workspace_task_comments` | Threaded comments, soft-delete, JSONB reactions |
| `workspace_sla_policies` | SLA hour budgets per priority + escalation multipliers |
| `workspace_sla_events` | Immutable SLA breach/escalation event log |
| `workspace_audit_trail` | Immutable append-only audit log with SHA-256 chain |

Includes DB-level UPDATE/DELETE prevention triggers on `workspace_audit_trail`.

---

## API Endpoints — V161-T01 … V161-T36 (36 new)

### Block A — Workspace Labels (T01–T10)
| Tag | Method | Path |
|---|---|---|
| V161-T01 | POST   | `/api/v1/workspaces/:id/labels` |
| V161-T02 | GET    | `/api/v1/workspaces/:id/labels` |
| V161-T03 | GET    | `/api/v1/workspaces/:id/labels/:labelId` |
| V161-T04 | PATCH  | `/api/v1/workspaces/:id/labels/:labelId` |
| V161-T05 | DELETE | `/api/v1/workspaces/:id/labels/:labelId` |
| V161-T06 | POST   | `/api/v1/workspaces/:id/tasks/:taskId/labels` |
| V161-T07 | DELETE | `/api/v1/workspaces/:id/tasks/:taskId/labels/:labelId` |
| V161-T08 | GET    | `/api/v1/workspaces/:id/tasks/:taskId/labels` |
| V161-T09 | GET    | `/api/v1/workspaces/:id/labels/:labelId/tasks` |
| V161-T10 | GET    | `/api/v1/workspaces/:id/labels/stats` |

### Block B — Task Comments (T11–T18)
| Tag | Method | Path |
|---|---|---|
| V161-T11 | POST   | `/api/v1/workspaces/:id/tasks/:taskId/comments` |
| V161-T12 | GET    | `/api/v1/workspaces/:id/tasks/:taskId/comments` |
| V161-T13 | GET    | `/api/v1/workspaces/:id/tasks/:taskId/comments/:commentId` |
| V161-T14 | PATCH  | `/api/v1/workspaces/:id/tasks/:taskId/comments/:commentId` |
| V161-T15 | DELETE | `/api/v1/workspaces/:id/tasks/:taskId/comments/:commentId` |
| V161-T16 | POST   | `/api/v1/workspaces/:id/tasks/:taskId/comments/:commentId/reactions` |
| V161-T17 | DELETE | `/api/v1/workspaces/:id/tasks/:taskId/comments/:commentId/reactions` |
| V161-T18 | GET    | `/api/v1/workspaces/:id/comments/stats` |

### Block C — SLA Policies (T19–T28)
| Tag | Method | Path |
|---|---|---|
| V161-T19 | POST   | `/api/v1/workspaces/:id/sla-policies` |
| V161-T20 | GET    | `/api/v1/workspaces/:id/sla-policies` |
| V161-T21 | GET    | `/api/v1/workspaces/:id/sla-policies/:policyId` |
| V161-T22 | PATCH  | `/api/v1/workspaces/:id/sla-policies/:policyId` |
| V161-T23 | DELETE | `/api/v1/workspaces/:id/sla-policies/:policyId` |
| V161-T24 | POST   | `/api/v1/workspaces/:id/sla/check` |
| V161-T25 | POST   | `/api/v1/workspaces/:id/sla/bulk-check` |
| V161-T26 | POST   | `/api/v1/workspaces/:id/sla/events` |
| V161-T27 | GET    | `/api/v1/workspaces/:id/sla/events` |
| V161-T28 | GET    | `/api/v1/workspaces/:id/sla/stats` |

### Block D — Audit Trail (T29–T33)
| Tag | Method | Path |
|---|---|---|
| V161-T29 | GET  | `/api/v1/workspaces/:id/audit-trail` |
| V161-T30 | GET  | `/api/v1/workspaces/:id/audit-trail/export` |
| V161-T31 | GET  | `/api/v1/workspaces/:id/audit-trail/verify` |
| V161-T32 | GET  | `/api/v1/workspaces/:id/audit-trail/stats` |
| V161-T33 | POST | `/api/v1/workspaces/:id/audit-trail` |

### Block E — Admin + Integration (T34–T36)
| Tag | Method | Path |
|---|---|---|
| V161-T34 | GET | `/api/v1/admin/system/summary/v161` |
| V161-T35 | GET | `/api/v1/deploy/check/v161` |
| V161-T36 | GET | `/api/v1/version` |

---

## Tests — 66 New (3 files)

| File | Tests | Coverage |
|---|---|---|
| `tests/v161Labels.test.js`   | 21 | createLabel, listLabels, getLabel, updateLabel, deleteLabel, applyLabel, removeLabel, getTaskLabels, getTasksByLabel, stats |
| `tests/v161Comments.test.js` | 22 | createComment, listComments, getComment, editComment, deleteComment, reactions, stats |
| `tests/v161SlaAudit.test.js` | 23 | createPolicy, listPolicies, checkTaskSla, bulkCheck, recordEvent, listEvents, stats; record, chain, list, verifyChain, stats (audit) |

**All 66 tests PASS ✓**

---

## Cumulative Metrics

| Metric | V160 | V161 | Delta |
|---|---|---|---|
| Server lines | 11,194 | 11,733 | +539 |
| Endpoints | 94 | 130 | +36 |
| Cumulative tests | ≥1,746 | ≥1,812 | +66 |
| DB migration phase | 34 | 35 | +1 |
| New lib modules | 4 | 4 | — |
| apps/web restored | ✗ | ✓ | ✓ |

---

## Sacred Files — MD5 Verified UNCHANGED

| File | MD5 |
|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` |
| `lib/auditLog.js`   | `e5a5c2c27801d2d03991bc8e5a1df8cb` |

---

## Protocol Compliance

- ✓ R1: Sacred files immutable (MD5 verified)
- ✓ R2: Endpoints labeled [V161-T01]…[V161-T36]
- ✓ R3: Full canonical ZIP delivered
- ✓ R4: No renumbering of V160 endpoints
- ✓ R5: All prior tests continue to pass (in-memory isolation)
- ✓ R6: Zero new external dependencies
- ✓ R7: In-memory + DB dual persistence for all 4 new services
- ✓ R8: `process.env.NODE_ENV === 'test'` export blocks present
- ✓ R9: CHANGELOG, NEXT_SESSION_PROMPT, AI_PROTOCOL created
- ✓ R10: Doc comments with version tags present in all new files
