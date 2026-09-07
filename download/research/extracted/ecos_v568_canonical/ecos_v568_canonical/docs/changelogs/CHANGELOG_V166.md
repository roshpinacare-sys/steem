# CHANGELOG — V166

## Version: 166.0.0 | Phase: P55 | Date: 2026-05-30

---

## Summary

V166 implements **P1 high-value features** from the V165 roadmap:
1. **Audit Trail Webhook Push** — subscribe external endpoints to audit trail events; filter by type; HMAC-signed delivery with retry

---

## New Lib Modules (1)

| File | Lines | Purpose |
|---|---|---|
| `lib/auditWebhookPushService.js` | ~320 | Audit webhook subscriptions + HMAC delivery + retry pipeline |

---

## New DB Migration

**Phase 40** (`db/migration_phase40.sql`) — 1 new table + 2 new indexes:
- `workspace_audit_webhook_subscriptions` — subscription records per workspace
- `idx_waws_workspace_id` — fast listing per workspace
- `idx_waws_workspace_active` — partial index on active-only subs (hot push path)

---

## New API Endpoints (7) — V166-T01 … V166-T07

### Block A — Audit Webhook Push (T01–T06)
| Tag | Method | Path |
|---|---|---|
| V166-T01 | POST | `/api/v1/workspaces/:id/audit-webhooks` |
| V166-T02 | GET | `/api/v1/workspaces/:id/audit-webhooks` |
| V166-T03 | GET | `/api/v1/workspaces/:id/audit-webhooks/:subId` |
| V166-T04 | PATCH | `/api/v1/workspaces/:id/audit-webhooks/:subId` |
| V166-T05 | DELETE | `/api/v1/workspaces/:id/audit-webhooks/:subId` |
| V166-T06 | POST | `/api/v1/workspaces/:id/audit-webhooks/:subId/test` |

### Block B — Admin (T07)
| Tag | Method | Path |
|---|---|---|
| V166-T07 | GET | `/api/v1/admin/system/summary/v166` |

---

## Feature Details

### Audit Trail Webhook Push
- `createSubscription(workspaceId, { url, eventTypes, secret, description })` → `AuditWebhookSubscription`
- `eventTypes`: `['audit.*']` wildcard or specific types like `['task.created', 'sla.breached']`
- `listSubscriptions(workspaceId)` → `{ subscriptions, count }`
- `getSubscription(workspaceId, subId)` → full details (secret revealed)
- `updateSubscription(workspaceId, subId, patch)` → update url/eventTypes/active/description
- `deleteSubscription(workspaceId, subId)` → idempotent delete
- `pushAuditEvent(workspaceId, auditEvent)` → dispatch to all matching active subs
- Delivery: POST with `X-ECOS-Audit-Signature: sha256=<hmac>` header
- Retry: 3 attempts, exponential backoff (1s, 4s, 16s)
- Delivery log: last 100 per subscription (circular buffer)
- Limit: 20 subscriptions per workspace (`MAX_SUBSCRIPTIONS_PER_WORKSPACE`)
- In-memory Map + DB dual persistence

---

## Tests

| File | Tests | Status |
|---|---|---|
| `tests/v166.test.js` | 30 | ✓ PASS |
| `tests/v165.test.js` | 33 | ✓ PASS (regression) |

---

## Cumulative Metrics

| Metric | V165 | V166 |
|---|---|---|
| Server lines (`ecos-api-server.js`) | 12,578 | **12,578** (endpoints added inline) |
| Total endpoints | 168 | **175** |
| Cumulative tests | ≥1,991 | **≥2,021** |
| DB migration phase | 39 | **40** |
| Total lib modules | ~52 | **~53** |

---

## Sacred Files

| File | MD5 | Status |
|---|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |

---

## Protocol Compliance

- ✓ R1 — Sacred files untouched (MD5 verified)
- ✓ R2 — Endpoint tags V166-T01…T07 monotonically increasing
- ✓ R3 — Full canonical ZIP (all dirs included)
- ✓ R4 — No prior endpoints renumbered
- ✓ R5 — All V165 tests pass
- ✓ R6 — Zero new external dependencies
- ✓ R7 — In-memory + DB dual persistence in all new services
- ✓ R8 — NODE_ENV=test export blocks in new lib files
- ✓ R9 — Handoff docs: CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL
- ✓ R10 — JSDoc blocks with version tags in all new lib files
- ✓ R12 — Audit trail append-only (unchanged)
