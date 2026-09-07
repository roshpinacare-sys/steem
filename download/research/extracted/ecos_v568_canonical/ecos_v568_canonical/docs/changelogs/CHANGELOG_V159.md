# CHANGELOG — V159

**Release:** ecos_v159_canonical  
**Phase:** P48 — Workspace Intelligence & Collaboration Layer  
**Date:** 2026-05-30  
**Base:** V158 (9,764 lines → V159: 10,391 lines, +627 lines server delta)  
**Cumulative Tests:** ≥1,674 (V158 baseline 1,608 + 66 new)  
**Sacred Files:** `lib/fiatLedger.js` MD5:563e9b1f9e67091a5b6527c0a92568e5 UNTOUCHED  
**Sacred Files:** `lib/auditLog.js` MD5:e5a5c2c27801d2d03991bc8e5a1df8cb UNTOUCHED

---

## New Lib Modules (3)

| File | Lines | Purpose |
|------|-------|---------|
| `lib/workspaceWebhookService.js` | 286 | Outbound HTTP webhooks with HMAC-SHA256 signing, retry (3×, exp backoff), delivery log, wildcard events |
| `lib/validatorTaskRouter.js` | 238 | Confidence-score + specialty-tag auto-assignment engine with load balancing and dry-run mode |
| `lib/workspaceInvitationService.js` | 257 | JWT-based membership invitation system (native HS256, 48h TTL, duplicate detection) |

---

## Database Migration — Phase 33

File: `db/migration_phase33.sql`

| Table | Purpose |
|-------|---------|
| `workspace_webhooks` | Webhook registration (url, secret, events, active flag) |
| `workspace_webhook_deliveries` | Delivery history per webhook (status, attempt count) |
| `workspace_invitations` | Pending/accepted/revoked invitations with expiry |
| `workspace_task_activity` | Per-task activity sub-log (status changes, assignments, comments) |
| `workspace_task_watchers` | Task subscription: user watches specific tasks |
| `workspace_archive` | Workspace soft-delete / archive tracking |
| `validator_routing_log` | Persistent auto-assignment decision log |

---

## New API Endpoints (44 Tasks)

### Block A — Workspace Webhooks (T03–T09)

| # | Method | Path | Description |
|---|--------|------|-------------|
| T03 | POST   | `/api/v1/workspaces/:id/webhooks` | Register webhook (url, events, description) |
| T04 | GET    | `/api/v1/workspaces/:id/webhooks` | List all webhooks for workspace |
| T05 | PATCH  | `/api/v1/workspaces/:id/webhooks/:hookId` | Update webhook (url, events, active, description) |
| T06 | DELETE | `/api/v1/workspaces/:id/webhooks/:hookId` | Delete webhook |
| T07 | GET    | `/api/v1/workspaces/:id/webhooks/:hookId/deliveries` | Delivery log (last 100) |
| T08 | POST   | `/api/v1/workspaces/:id/webhooks/:hookId/test` | Trigger test delivery |
| T09 | GET    | `/api/v1/workspaces/:id/webhooks/stats` | Workspace webhook stats (total, success rate) |

### Block B — Validator Task Auto-Assignment (T10–T14)

| # | Method | Path | Description |
|---|--------|------|-------------|
| T10 | POST | `/api/v1/workspaces/:id/tasks/:taskId/auto-assign` | Auto-assign task to best validator (dryRun supported) |
| T11 | GET  | `/api/v1/workspaces/:id/tasks/auto-assign-pool` | List available validators with scores |
| T12 | POST | `/api/v1/admin/validator-routing/validators` | Register validator profile |
| T13 | POST | `/api/v1/admin/validator-routing/config` | Update routing config (minConfidence, bonus, penalty) |
| T14 | GET  | `/api/v1/admin/validator-routing/stats` | Routing stats + recent decisions |

### Block C — Due-Date Reminders (T15–T16)

| # | Method | Path | Description |
|---|--------|------|-------------|
| T15 | GET  | `/api/v1/workspaces/:id/tasks/due-soon` | Tasks due within N hours (default 24) |
| T16 | POST | `/api/v1/workspaces/:id/tasks/reminders/config` | Configure reminder lead hours |

### Block D — Workspace Archive / Restore (T17–T19)

| # | Method | Path | Description |
|---|--------|------|-------------|
| T17 | POST | `/api/v1/workspaces/:id/archive` | Soft-delete / archive workspace |
| T18 | POST | `/api/v1/workspaces/:id/restore` | Restore archived workspace |
| T19 | GET  | `/api/v1/admin/workspaces/archived` | List all archived workspaces |

### Block E — Member Invitations (T20–T23)

| # | Method | Path | Description |
|---|--------|------|-------------|
| T20 | POST   | `/api/v1/workspaces/:id/invitations` | Create invitation (email, role, returns HS256 token) |
| T21 | POST   | `/api/v1/workspaces/invitations/accept` | Accept invitation (token + userId) |
| T22 | GET    | `/api/v1/workspaces/:id/invitations` | List invitations (filter by status) |
| T23 | DELETE | `/api/v1/workspaces/:id/invitations/:inviteId` | Revoke invitation |

### Block F — Task Tags API (T24–T27)

| # | Method | Path | Description |
|---|--------|------|-------------|
| T24 | GET   | `/api/v1/workspaces/:id/tasks/tags` | All tags in use with frequency counts |
| T25 | GET   | `/api/v1/workspaces/:id/tasks/tags/suggest?q=` | Tag autocomplete suggestions |
| T26 | GET   | `/api/v1/workspaces/:id/tasks/by-tag/:tag` | Tasks filtered by specific tag |
| T27 | PATCH | `/api/v1/workspaces/:id/tasks/tags/bulk` | Bulk add/remove tags on up to 200 tasks |

### Block G — Task Import / Export / Activity / Watchers (T28–T33)

| # | Method | Path | Description |
|---|--------|------|-------------|
| T28 | POST   | `/api/v1/workspaces/:id/tasks/import` | CSV import (title,description,status,priority,tags pipe-separated) |
| T29 | GET    | `/api/v1/workspaces/:id/tasks/export/json` | Full JSON export (tasks + stats), Content-Disposition attachment |
| T30 | GET    | `/api/v1/workspaces/:id/tasks/:taskId/activity` | Per-task activity sub-log |
| T31 | POST   | `/api/v1/workspaces/:id/tasks/:taskId/watch` | Subscribe user to task |
| T32 | DELETE | `/api/v1/workspaces/:id/tasks/:taskId/watch` | Unsubscribe user from task |
| T33 | GET    | `/api/v1/workspaces/:id/tasks/:taskId/watchers` | List task watchers |

### Block H — Health, Members, SLA, Admin (T34–T41)

| # | Method | Path | Description |
|---|--------|------|-------------|
| T34 | GET   | `/api/v1/workspaces/:id/health-score` | Health score 0–100, grade A–F |
| T35 | GET   | `/api/v1/workspaces/:id/members/:userId/tasks` | Tasks assigned to specific member |
| T36 | PATCH | `/api/v1/workspaces/:id/members/:userId/role` | Update member role |
| T37 | GET   | `/api/v1/admin/system/summary/v159` | System-wide summary (workspaces, tasks, webhooks, calibration) |
| T38 | GET   | `/api/v1/admin/ws/stats/v159` | Enriched WS stats (SSE + task counts + webhook + routing) |
| T39 | GET   | `/api/v1/admin/webhook-global/stats` | Global webhook delivery stats |
| T40 | GET   | `/api/v1/workspaces/:id/tasks/:taskId/sla` | SLA status for individual task |
| T41 | GET   | `/api/v1/workspaces/:id/tasks/sla-breaches` | All tasks breaching SLA thresholds |

### Block I — Version / Deploy (T42–T44)

| # | Method | Path | Description |
|---|--------|------|-------------|
| T42 | GET | `/api/v1/deploy/check/v159` | Deploy readiness (12 checks, DEPLOY_READY / DEPLOY_BLOCKED) |
| T43 | GET | `/api/v1/version` | V159 version override (semver 159.0.0, P48 features) |
| T44 | GET | `/api/v1/system/changelog/v159` | Changelog endpoint |

---

## Test Suite — V159 (66 new tests)

| File | Tests | Coverage |
|------|-------|---------|
| `tests/v159Webhooks.test.js`       | 24 | Registration, update, delete, dispatch, deliveries, HMAC, stats, timeout |
| `tests/v159ValidatorRouter.test.js` | 22 | Profile CRUD, findBest, autoAssign, dryRun, load, releaseLoad, listValidators, config |
| `tests/v159Invitations.test.js`    | 20 | Create, accept, revoke, list, duplicate, expiry, cleanup, native HS256 token |

**All 66 tests: PASS ✓**

---

## Webhook Event Catalog

`task.created` · `task.updated` · `task.assigned` · `task.done` · `task.deleted`  
`task.comment_added` · `task.overdue` · `task.due_soon`  
`member.added` · `member.removed`  
`workspace.archived` · `workspace.restored`  
`*` (wildcard — subscribe to all events)

---

## SLA Thresholds by Priority

| Priority | SLA (hours) |
|----------|-------------|
| critical | 4           |
| high     | 24          |
| medium   | 72          |
| low      | 168         |

---

## Invitation Token Format

Native HS256 JWT (no external `jsonwebtoken` dependency):  
- Algorithm: HMAC-SHA256  
- Header: `{"alg":"HS256","typ":"JWT"}`  
- TTL: 48 hours  
- Claims: `sub`, `workspaceId`, `email`, `role`, `inviteId`, `type: "workspace_invitation"`, `iat`, `exp`

---

## Breaking Changes

None. All V158 endpoints remain unchanged. V159 adds endpoints alongside V158.

## Known Limitations

- `workspace.archived` event integrates with V158 `_logWsActivity` helper (requires `_logWsActivity` defined in server)  
- CSV import capped at 500 rows per request  
- Webhook retry: 3 attempts only (0ms, 1s, 4s delays); persistent retry queue is a V160 candidate  
- `lib/workspaceInvitationService.js` uses self-contained HS256 (no `jsonwebtoken` dep) — compatible with production JWT_SECRET env var

## Next: V160 Candidates (Phase P49)

See `NEXT_SESSION_PROMPT_V159.md`
