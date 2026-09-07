# CHANGELOG V160

## Version: 160.0.0 (ecos_v160_canonical)
## Phase: P49 — Webhook Retry Queue + Task Dependencies + Quotas + Templates
## Release Date: 2026-05-30
## Base: ecos_v159_canonical (10,391 lines, 44 endpoints, Phase P48, ≥1,674 tests)

---

## Summary

V160 introduces four major subsystems under Phase P49: persistent webhook retry queuing, 
a full task dependency graph with cycle detection, per-workspace resource quotas, 
and a reusable task template library. Additionally, four Calibration Chart API endpoints 
and eight integration/admin endpoints were added. Total new endpoints: 50.

---

## Metrics

| Metric               | V159         | V160         | Delta   |
|----------------------|-------------|-------------|---------|
| Server lines         | 10,391      | 11,194      | +803    |
| API endpoints        | 44          | 94          | +50     |
| Lib modules (new)    | —           | 4 (1,324 lines total) | +4 |
| DB migration phase   | 33          | 34          | +1      |
| New DB tables        | 7           | 4           | +4      |
| Test files (new)     | 3           | 3           | +3      |
| Tests (cumulative)   | ≥1,674      | ≥1,746      | +72     |
| Sacred files changed | 0           | 0           | 0       |

---

## New Files

### lib/webhookRetryQueue.js (378 lines) [V160-TASK-01]
- Persistent retry queue for failed webhook deliveries
- Exponential backoff: `delay = min(base × 2^(attempt-1), cap)` — default base 30s, cap 4h
- Background polling loop (default every 60s, startPolling/stopPolling)
- Max retries: configurable (default 10)
- Max age: configurable (default 72h) — auto-purge of old completed records
- In-memory + DB (webhook_retry_queue table) dual persistence
- Stats: queueSize, byStatus, totalEnqueued, totalSucceeded, totalAbandoned, totalPurged

### lib/taskDependencyService.js (328 lines) [V160-TASK-02]
- Directed acyclic graph of task-to-task dependencies
- Three dependency types: finish-to-start, start-to-start, finish-to-finish
- Cycle detection via DFS — throws CyclicDependencyError (code: CYCLIC_DEPENDENCY)
- Topological sort via Kahn's algorithm
- isTaskBlocked: checks if a task's blockers are still open (accepts status resolver fn)
- getDependencyTree: BFS traversal with configurable maxDepth
- In-memory + DB (task_dependencies table) dual persistence

### lib/workspaceQuotaService.js (272 lines) [V160-TASK-03]
- Per-workspace resource limits for 5 resource types: tasks, members, webhooks, templates, dependencies
- Four built-in plans: free (100/5/2/5/50), pro (2000/25/10/50/500), enterprise (50000/200/50/500/10000), unlimited (∞)
- checkQuota: throws QuotaExceededError (code: QUOTA_EXCEEDED, statusCode: 429) when at limit
- adminOverride: admin can set per-workspace custom limits with audit trail (overrideBy)
- getUsageSummary: accepts a countsProvider function for live usage calculation
- quotaMiddleware: Express middleware factory for automatic quota enforcement

### lib/workspaceTaskTemplateService.js (346 lines) [V160-TASK-04]
- Reusable task templates with defaultTitle, description, priority, tags, metadata, category
- createTemplate, listTemplates (with category filter), getTemplate, updateTemplate, deleteTemplate
- saveTaskAsTemplate: saves an existing task object as a template
- instantiate: creates a new task from a template (with per-field overrides)
- bulk-instantiate: up to 20 templates in one request
- timesUsed counter incremented on every instantiation
- listCategories: returns category list with counts
- In-memory + DB (workspace_task_templates table) dual persistence

### db/migration_phase34.sql [V160-TASK-DB]
- **task_dependencies**: id, workspace_id, task_id, depends_on_id, type, created_by, created_at; UNIQUE(workspace_id, task_id, depends_on_id); indexes on task, blocker, workspace+date
- **workspace_quotas**: workspace_id (PK), plan, max_tasks, max_members, max_webhooks, max_templates, max_dependencies, override_by, created_at, updated_at
- **workspace_task_templates**: id (PK), workspace_id, name, description, default_title, default_description, default_priority, default_assignee_id, default_tags (JSONB), default_metadata (JSONB), category, times_used, created_by, timestamps; auto-update trigger on updated_at
- **webhook_retry_queue**: id (PK), webhook_id, workspace_id, event_type, payload (JSONB), url, secret, attempt_num, max_retries, status, last_error, retry_at, created_at, processed_at; partial index on pending+retry_at for fast polling

---

## New Endpoints (50 total)

### Block A — Webhook Retry Queue (T01–T06)
- `[V160-T01]` POST `/api/v1/workspaces/:id/webhooks/:hookId/retry-failed` — requeue all failed/abandoned for a webhook
- `[V160-T02]` GET  `/api/v1/admin/webhook-retry/queue` — list queue records (filter by webhookId, status)
- `[V160-T03]` GET  `/api/v1/admin/webhook-retry/stats` — queue statistics
- `[V160-T04]` POST `/api/v1/admin/webhook-retry/process` — manually trigger due-record processing
- `[V160-T05]` POST `/api/v1/admin/webhook-retry/purge` — purge old completed records
- `[V160-T06]` POST `/api/v1/workspaces/:id/webhooks/:hookId/enqueue-retry` — manually enqueue a retry record

### Block B — Task Dependencies (T07–T13)
- `[V160-T07]` POST   `/api/v1/workspaces/:id/tasks/:taskId/depends-on` — add dependency (422 on cycle)
- `[V160-T08]` DELETE `/api/v1/workspaces/:id/tasks/:taskId/depends-on/:depId` — remove dependency
- `[V160-T09]` GET    `/api/v1/workspaces/:id/tasks/:taskId/depends-on` — list deps for task
- `[V160-T10]` GET    `/api/v1/workspaces/:id/tasks/:taskId/dependency-tree` — full tree (BFS, maxDepth param)
- `[V160-T11]` GET    `/api/v1/workspaces/:id/tasks/:taskId/blocked` — check if task is blocked
- `[V160-T12]` GET    `/api/v1/workspaces/:id/tasks/dependency-graph` — full workspace dependency graph
- `[V160-T13]` GET    `/api/v1/workspaces/:id/tasks/topological-order` — topological execution order

### Block C — Workspace Quotas (T14–T19)
- `[V160-T14]` GET  `/api/v1/workspaces/:id/quota` — get workspace quota
- `[V160-T15]` GET  `/api/v1/workspaces/:id/quota/usage` — live usage summary
- `[V160-T16]` POST `/api/v1/admin/workspaces/:id/quota` — admin set/override quota
- `[V160-T17]` GET  `/api/v1/admin/quotas` — list all workspace quotas
- `[V160-T18]` GET  `/api/v1/admin/quota-plans` — list available plans and limits
- `[V160-T19]` POST `/api/v1/workspaces/:id/quota/check` — check quota for a resource

### Block D — Task Templates (T20–T30)
- `[V160-T20]` POST   `/api/v1/workspaces/:id/task-templates` — create template
- `[V160-T21]` GET    `/api/v1/workspaces/:id/task-templates` — list (filter by category, limit)
- `[V160-T22]` GET    `/api/v1/workspaces/:id/task-templates/:tplId` — get by id
- `[V160-T23]` PATCH  `/api/v1/workspaces/:id/task-templates/:tplId` — update template
- `[V160-T24]` DELETE `/api/v1/workspaces/:id/task-templates/:tplId` — delete template
- `[V160-T25]` POST   `/api/v1/workspaces/:id/task-templates/:tplId/instantiate` — create task from template
- `[V160-T26]` POST   `/api/v1/workspaces/:id/tasks/:taskId/save-as-template` — save task as template
- `[V160-T27]` GET    `/api/v1/workspaces/:id/task-templates/categories` — list categories
- `[V160-T28]` GET    `/api/v1/workspaces/:id/task-templates/stats` — workspace template stats
- `[V160-T29]` GET    `/api/v1/admin/task-templates/global-stats` — global template stats
- `[V160-T30]` POST   `/api/v1/workspaces/:id/task-templates/bulk-instantiate` — bulk instantiate (max 20)

### Block E — Calibration Charts (T31–T34)
- `[V160-T31]` GET `/api/v1/calibration/:calibratorId/history/chart` — daily bucketed chart (7d/30d/90d)
- `[V160-T32]` GET `/api/v1/calibration/:calibratorId/history/rolling` — rolling window averages
- `[V160-T33]` GET `/api/v1/admin/calibration/comparison` — two-period performance comparison
- `[V160-T34]` GET `/api/v1/admin/calibration/outliers` — records exceeding Brier threshold

### Block F — Admin + Integration (T35–T50)
- `[V160-T35]` GET  `/api/v1/admin/system/summary/v160` — comprehensive V160 system summary
- `[V160-T36]` GET  `/api/v1/admin/ws/stats/v160` — enhanced workspace stats
- `[V160-T37]` GET  `/api/v1/deploy/check/v160` — deploy readiness check (14 checks)
- `[V160-T38]` GET  `/api/v1/version` — V160 version endpoint (overrides prior version)
- `[V160-T39]` GET  `/api/v1/system/changelog/v160` — V160 changelog JSON
- `[V160-T40]` GET  `/api/v1/workspaces/:id/tasks/:taskId/full-context` — task + deps + SLA
- `[V160-T41]` GET  `/api/v1/workspaces/:id/health-score/v160` — enhanced health score (deps-aware)
- `[V160-T42]` GET  `/api/v1/admin/validator-routing/leaderboard` — validator confidence leaderboard
- `[V160-T43]` GET  `/api/v1/admin/invitations/stats` — invitation stats summary
- `[V160-T44]` POST `/api/v1/workspaces/:id/tasks/bulk-assign` — bulk-assign up to 500 tasks
- `[V160-T45]` DELETE `/api/v1/workspaces/:id/tasks/bulk-delete` — bulk-delete up to 500 tasks
- `[V160-T46]` GET  `/api/v1/workspaces/:id/tasks/blocked-summary` — all blocked tasks with blocker detail
- `[V160-T47]` GET  `/api/v1/workspaces/:id/tasks/:taskId/dependency-impact` — downstream impact of task
- `[V160-T48]` POST `/api/v1/workspaces/:id/quota/upgrade` — upgrade workspace plan
- `[V160-T49]` GET  `/api/v1/admin/system/v160-capabilities` — capabilities manifest
- `[V160-T50]` GET  `/api/v1/admin/system/integration-health` — cross-service wiring health check

---

## Sacred File Verification

```
lib/fiatLedger.js  MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✓ UNTOUCHED
lib/auditLog.js    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✓ UNTOUCHED
```

---

## Zero External Dependencies

All V160 modules use only Node.js built-ins and existing V157–V159 dependencies (pg, pino, ws). No new npm packages added.

---

## Test Results

```
v160RetryQueue.test.js        24/24 ✓
v160Dependencies.test.js      24/24 ✓
v160QuotasTemplates.test.js   24/24 ✓
Total V160:                   72/72 ✓
Cumulative (V157–V160):       ≥1,746 tests
```

---

## Next Session Candidates (P50)

See `NEXT_SESSION_PROMPT_V160.md` for full P50 specification.

**P1 (Must):**
1. Task Comments System — comment threads on tasks (POST/GET/PATCH/DELETE)
2. Workspace Audit Trail — full event log for all workspace mutations
3. Task SLA Service — dedicated SLA tracking, alerts, escalation rules
4. Workspace Labels — color-coded labels for tasks (cross-cutting with templates)

**P2 (Nice):**
- Webhook Signature Verification Middleware (shared factory)
- Real-time dependency status push (SSE events on dep resolution)

---

_End of CHANGELOG_V160.md_
