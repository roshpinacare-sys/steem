# AI_PROTOCOL_V160.md
## Cross-Builder Communication Protocol — ECOS V160

---

## Purpose

This document establishes the inter-agent protocol for handing off the ECOS project
between AI builders across versions. Any AI receiving this ZIP must follow these rules.

---

## Protocol Rules

### R1 — Sacred File Immutability
The following files are SACRED and must NEVER be modified in any version:
```
lib/fiatLedger.js   MD5: 563e9b1f9e67091a5b6527c0a92568e5
lib/auditLog.js     MD5: e5a5c2c27801d2d03991bc8e5a1df8cb
```
Before packaging any ZIP, verify:
```bash
md5sum lib/fiatLedger.js lib/auditLog.js
```
If either MD5 has changed, HALT and alert the user. Do not package.

### R2 — Version Numbering
- package.json version: `{major}.0.0` where major = V number (e.g., V160 → "160.0.0")
- Endpoint labels: `[V{n}-T{nn}]` — sequential within each version
- Test files: `tests/v{n}FeatureName.test.js`
- DB migration: `db/migration_phase{n}.sql`

### R3 — Canonical ZIP Structure
Every release must be a FULL canonical ZIP (not delta):
```
ecos_v{n}_canonical/
├── ecos-api-server.js      (cumulative, all versions)
├── package.json            (version updated)
├── lib/                    (all lib files, cumulative)
├── db/                     (migration_phase1.sql … migration_phase{n}.sql)
├── tests/                  (all test files, cumulative)
├── CHANGELOG_V{n}.md
├── NEXT_SESSION_PROMPT_V{n}.md
├── AI_PROTOCOL_V{n}.md     (this file, updated per version)
├── config/
├── apps/
├── docs/
└── docker-compose.yml, Dockerfile, etc.
```

### R4 — Endpoint Continuity
- Never renumber existing endpoints
- New endpoints append after all previous version endpoints
- The `/api/v1/version` endpoint is always overwritten with the current version
- The `/api/v1/deploy/check/v{n}` endpoint verifies all services for the current version

### R5 — Test Continuity
- All previous-version tests must still pass
- New tests must be standalone Node.js scripts
- Each new version adds ≥ 60 tests
- Cumulative total must always increase

### R6 — Zero External Deps Policy
No new npm packages may be added without explicit user approval.
All new lib modules must use only:
- Node.js built-ins (crypto, fs, http/https, events, url, assert)
- Existing deps: pg, pino, ws (already in package.json)

### R7 — In-Memory + DB Dual Persistence
All service classes must:
- Maintain an in-memory Map as primary storage
- Attempt DB operations with try/catch and `_log.warn` on failure
- Never crash if `this._db` is null/undefined
- Export a `setDb(pool)` method

### R8 — Export Block Pattern
Services must be exported in test mode using this pattern:
```javascript
if (process.env.NODE_ENV === 'test') {
  module.exports._serviceName = _serviceInstance;
  module.exports.ErrorClassName = ErrorClassName;
}
```

### R9 — Handoff Documents Required
Every version ZIP must contain:
- `CHANGELOG_V{n}.md` — full changelog with metrics table
- `NEXT_SESSION_PROMPT_V{n}.md` — complete instructions for V{n+1} builder
- `AI_PROTOCOL_V{n}.md` — this protocol (copy + update version references)

### R10 — Documentation Comments
All lib files must include:
- File header with version tag (e.g., `V160`)
- `[V160-TASK-nn]` identifier
- Sacred files note: `Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED`
- Key feature list in JSDoc comment block

---

## Version History

| Version | Phase | Endpoints | Tests | DB Phase | Key Feature |
|---------|-------|-----------|-------|----------|-------------|
| V157    | P45   | ~20       | ~1,400| 30       | Base workspace tasks + SSE |
| V158    | P46   | ~30       | ~1,500| 31       | Calibration history delta |
| V159    | P48   | 44        | ≥1,674| 33       | Webhooks + InvitationService + ValidatorRouter |
| V160    | P49   | 94        | ≥1,746| 34       | RetryQueue + Dependencies + Quotas + Templates |
| V161    | P50   | ≥130      | ≥1,810| 35       | Comments + AuditTrail + SLA + Labels [PENDING] |

---

## V160 Service Registry

| Service Var | Class | Module | DB Table(s) |
|-------------|-------|--------|-------------|
| `_wts` | WorkspaceTaskService | lib/workspaceTaskService.js | workspace_tasks |
| `_calibHistory` | CalibrationHistoryService | lib/calibrationHistoryService.js | calibration_history |
| `_wsFeed` | WorkspaceRealTimeFeed | lib/workspaceRealTimeFeed.js | — (SSE) |
| `_webhooks` | WorkspaceWebhookService | lib/workspaceWebhookService.js | workspace_webhooks, workspace_webhook_deliveries |
| `_vtRouter` | ValidatorTaskRouter | lib/validatorTaskRouter.js | validator_routing_log |
| `_invitations` | WorkspaceInvitationService | lib/workspaceInvitationService.js | workspace_invitations |
| `_retryQueue` | WebhookRetryQueue | lib/webhookRetryQueue.js | webhook_retry_queue |
| `_deps` | TaskDependencyService | lib/taskDependencyService.js | task_dependencies |
| `_quotas` | WorkspaceQuotaService | lib/workspaceQuotaService.js | workspace_quotas |
| `_templates` | WorkspaceTaskTemplateService | lib/workspaceTaskTemplateService.js | workspace_task_templates |

---

## Error Codes Registry

| Code | Class | HTTP Status | Module |
|------|-------|-------------|--------|
| `CYCLIC_DEPENDENCY` | CyclicDependencyError | 422 | lib/taskDependencyService.js |
| `QUOTA_EXCEEDED` | QuotaExceededError | 429 | lib/workspaceQuotaService.js |
| (inherit) | WorkspaceNotFoundError | 404 | lib/workspaceTaskService.js |
| (inherit) | TaskNotFoundError | 404 | lib/workspaceTaskService.js |

---

## AI Builder Quick-Start (V161)

1. Unzip `ecos_v160_canonical.zip` → working directory
2. Read this file + `NEXT_SESSION_PROMPT_V160.md` in full
3. Read `CHANGELOG_V160.md` — note last endpoint number (V160-T50)
4. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
5. Create new lib modules (P50 scope in NEXT_SESSION_PROMPT)
6. Append migration_phase35.sql
7. Append V161 endpoints block to ecos-api-server.js (after V160 export block)
8. Create test files → run → 0 failures
9. Update package.json → "161.0.0"
10. Verify sacred files again
11. Package full canonical ZIP + docs

---

_This document is machine-generated and maintained by the AI builder. Human review recommended for protocol rule changes._
_AI_PROTOCOL_V160.md — ECOS Project — 2026-05-30_
