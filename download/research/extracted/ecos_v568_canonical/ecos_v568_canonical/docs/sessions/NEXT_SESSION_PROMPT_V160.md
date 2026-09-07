# NEXT SESSION PROMPT — V160 → V161

## Context Handoff for AI Builder

You are continuing development of the **ECOS** (Ecosystem Calibration & Operations System) project.
This document hands off the exact state of V160 and defines the V161 work scope.

---

## Current State: V160 (ecos_v160_canonical)

- **Server:** `ecos-api-server.js` — 11,194 lines, 94 endpoints
- **Phase:** P49 COMPLETE
- **Tests:** ≥1,746 cumulative (72 new in V160, all passing)
- **DB Migration:** Phase 34 (migration_phase34.sql — 4 new tables)

### V160 New Lib Modules
| File | Lines | Purpose |
|------|-------|---------|
| lib/webhookRetryQueue.js | 378 | Persistent retry queue, exp backoff, polling |
| lib/taskDependencyService.js | 328 | DAG deps, cycle detect, topo sort |
| lib/workspaceQuotaService.js | 272 | Resource quotas, plan limits, 429 enforcement |
| lib/workspaceTaskTemplateService.js | 346 | Task templates, instantiate, bulk |

### Sacred Files (MUST REMAIN UNTOUCHED IN ALL FUTURE VERSIONS)
```
lib/fiatLedger.js   MD5: 563e9b1f9e67091a5b6527c0a92568e5
lib/auditLog.js     MD5: e5a5c2c27801d2d03991bc8e5a1df8cb
```

---

## V161 Target Metrics

| Metric | V160 | V161 Target |
|--------|------|-------------|
| Server lines | 11,194 | ≥12,000 |
| Endpoints | 94 | ≥130 |
| Tests (cumulative) | ≥1,746 | ≥1,810 |
| New lib modules | — | 4 |
| DB migration | phase34 | phase35 |
| Phase | P49 | P50 |

---

## V161 Work Scope (Phase P50)

### P1 — Must Implement

#### 1. Task Comments System (`lib/workspaceTaskCommentService.js`)
- Comment threads on tasks: `workspaceId + taskId + commentId`
- Reply support (parentCommentId)
- Edit + soft-delete (deleted_at, body replaced with "[deleted]")
- Reactions (emoji counts, stored in metadata)
- DB table: `workspace_task_comments`
- Endpoints: POST/GET/PATCH/DELETE `/api/v1/workspaces/:id/tasks/:taskId/comments[/:commentId]`
- Estimated: ~320 lines lib, 8 endpoints

#### 2. Workspace Audit Trail (`lib/workspaceAuditTrailService.js`)
- Immutable append-only log of all workspace mutations
- Events: task.created, task.updated, task.deleted, member.invited, webhook.fired, quota.changed, template.instantiated, dependency.added
- Query: by workspaceId, by actorId, by event type, time range, cursor pagination
- DB table: `workspace_audit_trail`
- Endpoints: GET `/api/v1/workspaces/:id/audit-trail` (list), GET `/api/v1/workspaces/:id/audit-trail/export` (JSON export)
- Estimated: ~290 lines lib, 5 endpoints

#### 3. Task SLA Service (`lib/workspaceTaskSlaService.js`)
- Dedicated SLA policy definition: priority → max resolution hours
- SLA breach detection: task age > SLA hours for its priority
- SLA escalation rules: breach count → notification level (warn/alert/critical)
- Bulk SLA check: returns all breached tasks in a workspace
- DB table: `workspace_sla_policies`, `workspace_sla_events`
- Endpoints: CRUD policies, GET breach list, POST manual check
- Estimated: ~350 lines lib, 10 endpoints

#### 4. Workspace Labels (`lib/workspaceLabelsService.js`)
- Color-coded labels for tasks: name, color (#hex), description
- Apply/remove labels from tasks (many-to-many)
- Filter tasks by label
- DB tables: `workspace_labels`, `workspace_task_labels`
- Endpoints: CRUD labels, apply/remove from task, list tasks by label
- Estimated: ~280 lines lib, 10 endpoints

### P2 — Nice to Have
- Webhook signature verification middleware factory
- Real-time dependency resolution push (SSE events when blocker task → done)
- Template versioning (version number per template, snapshot history)

---

## Starting Instructions for V161 Builder

1. **Copy V160 canonical as base** — do not modify V160 files directly
2. **Create lib files** — in this order: Labels → Comments → SLA → AuditTrail
3. **Create db/migration_phase35.sql** — all 5 new tables in a single migration file
4. **Append endpoints to ecos-api-server.js** — after the V160 export block
5. **Create tests** — 3 test files, each with 22+ tests; target 66+ new tests
6. **Update package.json** — version to "161.0.0"
7. **Verify sacred files** — MD5 check on fiatLedger.js and auditLog.js
8. **Package** — ecos_v161_canonical.zip (full, not delta)
9. **Create** — CHANGELOG_V161.md + NEXT_SESSION_PROMPT_V161.md + AI_PROTOCOL_V161.md

---

## Key Implementation Notes

### Do NOT break these patterns
- All V159/V160 endpoints must remain working
- `exports._retryQueue`, `exports._deps`, `exports._quotas`, `exports._templates` must still be exported in test mode
- Extend the deploy/check endpoint to include V161 services
- Update `/api/v1/version` to V161
- All new endpoints must return `ecosVersion: 'V161'`

### DB conventions
- Use `workspace_id TEXT NOT NULL` on all workspace-scoped tables
- JSONB for flexible metadata/payload fields
- Timestamps: `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- Use `ON CONFLICT ... DO NOTHING` in INSERTs from lib code
- Wrap migration in `BEGIN; ... COMMIT;`

### Test conventions
- Standalone Node.js scripts (`node tests/v161X.test.js`)
- No test framework required — use `assert` module
- Print `✓ name` / `✗ name` per test
- Exit code 1 if any test fails

---

## File to Read First
`/ecos_v160_canonical/CHANGELOG_V160.md` — review endpoint list before appending new ones to avoid numbering conflicts.

---

_End of NEXT_SESSION_PROMPT_V160.md — V161 starts here_
