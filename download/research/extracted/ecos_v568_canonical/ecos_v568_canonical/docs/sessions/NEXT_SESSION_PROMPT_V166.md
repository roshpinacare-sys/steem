# Next Session Prompt — V166 → V167

## Context Summary

**Current version:** V166 (Phase P55 COMPLETE)
**Server:** `ecos-api-server.js` — 12,578 lines
**Cumulative tests:** ≥2,021 (V166: +30 new; all passing ✓)
**DB Migrations:** Phase 40 applied (1 new table + 2 new indexes)
**Sacred files locked:** `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5` · `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

---

## V166 Deliverables Completed

### New Lib Modules
- `lib/auditWebhookPushService.js` — subscribe external endpoints to audit events, wildcard and specific event type filters, HMAC-SHA256 signed delivery, 3-retry exponential backoff, delivery log (last 100 per sub), limit 20 subs/workspace

### DB — Phase 40
- `workspace_audit_webhook_subscriptions` — subscription records per workspace

### API Endpoints (7 — V166-T01 … V166-T07)
- Block A: Audit Webhook Push Subscriptions (T01–T06)
- Block B: Admin summary V166 (T07)

### Tests
- `tests/v166.test.js` — 30 tests ✓ PASS

---

## Cumulative State at V166

| Metric | Value |
|---|---|
| Server lines | 12,578 |
| Total endpoints | 175 |
| Cumulative tests | ≥2,021 |
| DB migration phase | 40 |
| Total lib modules | ~53 |

---

## V167 Candidates — Phase P56

### P1 (Highest Value)

1. **Workspace Activity Feed** — paginated stream of all events (tasks, comments, SLA, bulk ops)
   - `GET /workspaces/:id/activity` — filterable by type/actor/date, cursor pagination
   - Real-time fan-out via existing WebSocket hub

2. **Custom Field Bulk Update** — set field values on multiple tasks in one request
   - `POST /workspaces/:id/custom-fields/:fieldId/bulk-set`
   - Validate values per field type, return per-task success/failure

### P2
3. **Validator Performance Dashboard** — combined SLA + time tracking stats per validator
4. **Task Recurrence Rules** — define repeating tasks with RRULE-like spec

---

## Rules to Carry Forward

- **R1**: Sacred files immutable — verify MD5 before packaging
- **R2**: Endpoint tags `[V167-T01]` … ascending
- **R3**: Full canonical ZIP
- **R4**: No renumbering prior endpoints
- **R5**: All prior tests must pass
- **R6**: Zero new external dependencies
- **R7**: In-memory + DB dual persistence
- **R8**: `NODE_ENV === 'test'` export blocks
- **R9**: Handoff docs (CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL)
- **R10**: JSDoc with version tags in all new lib files
- **R12**: Audit trail append-only

---

## New Session Startup Checklist

1. Extract `ecos_v166_canonical.zip`
2. Verify sacred files: `md5sum lib/fiatLedger.js lib/auditLog.js`
3. Confirm server: `wc -l ecos-api-server.js` → ~12,578
4. Confirm version: `grep '"version"' package.json` → `"166.0.0"`
5. Run V166 tests: `NODE_ENV=test node tests/v166.test.js` → 30 PASS
6. Begin V167 per P56 candidates above
