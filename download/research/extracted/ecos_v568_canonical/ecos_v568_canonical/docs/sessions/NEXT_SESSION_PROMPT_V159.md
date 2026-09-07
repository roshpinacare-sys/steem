# Next Session Prompt — V159 → V160

## Context Summary

**Current version:** V159 (Phase P48 COMPLETE)  
**Server:** `ecos-api-server.js` — 10,391 lines  
**Cumulative tests:** ≥1,674 (V158: 1,608 + V159: 66 new)  
**DB Migrations:** Phase 33 applied (7 new tables)  
**Sacred files locked:** `lib/fiatLedger.js` MD5:563e9b1f9e67091a5b6527c0a92568e5 · `lib/auditLog.js` MD5:e5a5c2c27801d2d03991bc8e5a1df8cb

---

## V159 Deliverables Completed

### New Lib Modules
- `lib/workspaceWebhookService.js` — outbound webhooks, HMAC-SHA256, retry (3×), delivery log
- `lib/validatorTaskRouter.js` — confidence-score + specialty-tag auto-assignment, load balancing
- `lib/workspaceInvitationService.js` — native HS256 invitation tokens, 48h TTL, duplicate detection

### DB — Phase 33 (7 tables)
`workspace_webhooks`, `workspace_webhook_deliveries`, `workspace_invitations`,  
`workspace_task_activity`, `workspace_task_watchers`, `workspace_archive`, `validator_routing_log`

### API Endpoints (44 tasks)
- Blocks A–I: Webhooks, Validator Routing, Due-Date Reminders, Archive/Restore, Invitations, Tags, Import/Export, Activity, Watchers, Health Score, SLA, Member Role, Admin, Version/Deploy

### Tests
- `tests/v159Webhooks.test.js` — 24 tests ✓ PASS
- `tests/v159ValidatorRouter.test.js` — 22 tests ✓ PASS  
- `tests/v159Invitations.test.js` — 20 tests ✓ PASS

---

## V160 Candidates — Phase P49

### P1 (Critical / Highest Value)

1. **Webhook Persistent Retry Queue** (`lib/webhookRetryQueue.js`)  
   - Failed deliveries stored in `workspace_webhook_deliveries` with `retry_at` scheduling  
   - Background polling loop (integrate into metrics cron)  
   - Configurable max retries (default 10), max age (default 72h)  
   - Endpoints: `POST /workspaces/:id/webhooks/:hookId/retry-failed`, `GET /admin/webhook-retry/queue`

2. **Task Dependency Graph** (`lib/taskDependencyService.js`)  
   - Tasks can block/depend-on other tasks (`task_dependencies` join table)  
   - Cycle detection (DFS), topological sort  
   - Endpoints: `POST/DELETE /workspaces/:id/tasks/:taskId/depends-on`, `GET /workspaces/:id/tasks/:taskId/dependency-tree`  
   - Auto-block dependent tasks when blocker is incomplete

3. **Workspace Quota Manager** (`lib/workspaceQuotaService.js`)  
   - Per-workspace limits: max tasks, max members, max webhooks  
   - Quota check middleware: return 429 when exceeded  
   - Admin override: `POST /admin/workspaces/:id/quota`  
   - DB table: `workspace_quotas`

4. **Task Template System** (`lib/workspaceTaskTemplateService.js`)  
   - Save task as template (title, description, tags, priority, assigneeId)  
   - Instantiate template → new task  
   - Endpoints: `POST/GET/DELETE /workspaces/:id/task-templates`

### P2 (High Value)

5. **Calibration History Chart API** (extend `lib/calibrationHistoryService.js`)  
   - Endpoint: `GET /api/v1/calibration/:calibratorId/history/chart?range=7d`  
   - Returns time-series array `[{date, score, sampleCount}]` suitable for Chart.js  
   - Aggregation: daily buckets, rolling 7/30/90 day windows

6. **Task Recurrence Scheduling**  
   - Recurring tasks (daily/weekly/monthly) via cron expression stored in task  
   - Auto-create next task when current one completes  
   - DB column: `workspace_tasks.recurrence_rule`

7. **Workspace Bulk Operations**  
   - `POST /workspaces/:id/tasks/bulk-status` — change status for N tasks at once  
   - `POST /workspaces/:id/tasks/bulk-assign` — assign N tasks to validator  
   - `DELETE /workspaces/:id/tasks/bulk-delete` — soft-delete N tasks  
   - Max batch: 500 tasks

8. **Enhanced WorkspaceAuth DB Integration**  
   - Wire `middleware/workspaceAuth.js` `getMembership()` to read from `workspace_members` table  
   - Currently returns mock data — hook to DB for real role enforcement  
   - `WORKSPACE_AUTH_DB_ENABLED=true` env flag for gradual rollout

### P3 (Valuable / Deferrable)

9. **Rate Limiting on Task Endpoints**  
   - `lib/workspaceRateLimiter.js` — sliding window (Redis or in-memory Map)  
   - Apply to: task create/update, webhook register, invitation create  
   - Configurable per-workspace limits via `workspace_quotas` table

10. **Task Activity Export** — export task activity log as CSV  
    `GET /workspaces/:id/tasks/:taskId/activity/export/csv`

11. **Admin Invitation Stats** — `GET /admin/invitations/stats` (total, pending, accepted rates by workspace)

12. **Validator Leaderboard** — `GET /admin/validator-routing/leaderboard` (ranked by assignments, success rate, avg score)

---

## Technical Notes for V160

- **No new external npm deps** — maintain zero-external-dep test compatibility
- **Cron loop** — V159's due-soon checker is on-demand; V160 should integrate into the existing metrics loop as a scheduled scan (every 15min by default)
- **`_logWsActivity` helper** — already available in V158 server; V159 archive endpoints depend on it — confirm it's defined before line 9,765 in the server
- **`_calibHistory.length`** — the V159 admin stats endpoint calls `_calibHistory.length`; verify `CalibrationHistoryService` exposes this getter, or change to `_calibHistory.count()` if not

## Verification for Next Session

Before starting V160:
1. Run `node tests/v159Webhooks.test.js` — expect 24/24 PASS
2. Run `node tests/v159ValidatorRouter.test.js` — expect 22/22 PASS  
3. Run `node tests/v159Invitations.test.js` — expect 20/20 PASS
4. Verify `GET /api/v1/deploy/check/v159` → `"verdict": "DEPLOY_READY"`
5. Confirm sacred file MDs5s unchanged

## Target Metrics for V160

| Metric | V159 Actual | V160 Target |
|--------|-------------|-------------|
| Server lines | 10,391 | ≥11,200 |
| New endpoints | 44 | ≥44 |
| Cumulative tests | ≥1,674 | ≥1,730 |
| New lib files | 3 | ≥3 |
| DB tables added | 7 | ≥4 |
| ZIP size | ≥500KB | ≥600KB |
