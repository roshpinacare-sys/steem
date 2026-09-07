# Migration Notes — V159

**Phase:** P48  
**DB Migration:** `db/migration_phase33.sql` (Phase 33 — run after Phase 32)  
**Applies to:** Any deployment running V158 or earlier

---

## Prerequisites

- V157 migrations (Phases 1–31) applied  
- V158 migration (`db/migration_phase32.sql` — Phase 32) applied  
- PostgreSQL ≥ 12  
- `jsonwebtoken` or JWT_SECRET env var set (for invitation service; built-in HS256 used if no external package available)

---

## Step 1 — Apply DB Migration

```sql
-- Run against your PostgreSQL instance:
\i db/migration_phase33.sql
```

Or via psql:
```bash
psql $DATABASE_URL -f db/migration_phase33.sql
```

The migration is wrapped in a `BEGIN/COMMIT` transaction.  
All `CREATE TABLE` and `CREATE INDEX` statements use `IF NOT EXISTS` — **idempotent** and safe to re-run.

### Tables Created

| Table | Key Columns |
|-------|------------|
| `workspace_webhooks` | `id`, `workspace_id`, `url`, `secret`, `events JSONB`, `active`, `delivery_count` |
| `workspace_webhook_deliveries` | `webhook_id REFERENCES workspace_webhooks`, `event_type`, `http_status`, `success` |
| `workspace_invitations` | `id`, `workspace_id`, `email`, `role CHECK(...)`, `token`, `status CHECK(...)`, `expires_at` |
| `workspace_task_activity` | `task_id`, `workspace_id`, `actor_id`, `action`, `old_value JSONB`, `new_value JSONB` |
| `workspace_task_watchers` | `task_id`, `user_id` (PK composite) |
| `workspace_archive` | `workspace_id` (PK), `is_archived`, `archived_at`, `restored_at` |
| `validator_routing_log` | `id`, `task_id`, `validator_id`, `routing_score`, `task_tags JSONB` |

### Indexes Created (9 total)

```
idx_webhooks_workspace, idx_webhooks_active
idx_webhook_deliveries_hook, idx_webhook_deliveries_ws
idx_invitations_workspace, idx_invitations_email, idx_invitations_expires (partial)
idx_task_activity_task, idx_task_activity_ws, idx_task_activity_actor
idx_task_watchers_task, idx_task_watchers_user
idx_workspace_archive_archived
idx_routing_log_task, idx_routing_log_validator, idx_routing_log_decided
```

---

## Step 2 — Deploy New Lib Files

Copy these files into your deployment alongside the updated server:

```
lib/workspaceWebhookService.js   ← NEW in V159
lib/validatorTaskRouter.js       ← NEW in V159
lib/workspaceInvitationService.js ← NEW in V159
```

Existing V158 files (unchanged, copy as-is):
```
lib/workspaceTaskService.js
lib/calibrationHistoryService.js
lib/workspaceRealTimeFeed.js
middleware/workspaceAuth.js
```

---

## Step 3 — Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `JWT_SECRET` | Recommended | `'ecos-dev-invitation-secret'` | Used for invitation token signing (HS256). Set a strong random value in production. |
| `TASK_REMINDER_HOURS` | Optional | `24` | Lead hours for due-soon reminder checks |
| `DATABASE_URL` | Required | — | PostgreSQL connection URL |

> **Security Note:** The `JWT_SECRET` used for invitation tokens should be distinct from any other JWT secret in your stack. Min 32 bytes recommended.

---

## Step 4 — Replace ecos-api-server.js

Replace with `ecos-api-server.js` from this package (10,391 lines, V159).  
The V159 block appended at the bottom does `require()` for the 3 new lib modules at startup.

**No changes** to V158 routes — they remain intact.

---

## Step 5 — Verify Deployment

Hit the deploy-check endpoint:
```
GET /api/v1/deploy/check/v159
```

Expected response:
```json
{
  "ok": true,
  "verdict": "DEPLOY_READY",
  "version": "V159",
  "phase": "P48",
  "criticalFails": 0
}
```

If `criticalFails > 0`, check the `failedChecks` array in the response.

---

## Step 6 — Confirm Version

```
GET /api/v1/version
```

Expected: `"version": "V159"`, `"semver": "159.0.0"`

---

## Rollback Plan

V159 is strictly additive:
1. Revert `ecos-api-server.js` to V158 — V158 endpoints continue working
2. V159 DB tables are inert if the server doesn't reference them
3. No column alterations were made to any V158/V157 tables

---

## Data Migration Notes

No data migration required. All new tables start empty.  
Existing `workspace_tasks`, `workspace_members`, `workspace_activity_log`, `workspace_task_comments`, `calibration_history` tables are **untouched**.

---

## Sacred File Integrity

| File | MD5 | Status |
|------|-----|--------|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js`   | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |
