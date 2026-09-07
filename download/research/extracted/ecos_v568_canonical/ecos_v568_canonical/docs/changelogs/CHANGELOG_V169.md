# CHANGELOG — V169

## Version: 169.0.0 | Phase: P58 | Date: 2026-05-30

---

## Summary

V169 implements **P58 high-value features** from the V168 roadmap:
1. **Task Recurrence Rules** — define repeating tasks with RRULE-like spec (daily/weekly/monthly), interval, until, count
2. **Activity Feed Subscriptions (Webhooks)** — push webhooks on activity feed events with event-type filtering and retry on failure

---

## New Lib Modules (2)

| File | Lines | Purpose |
|---|---|---|
| `lib/taskRecurrenceService.js` | ~200 | Task recurrence rules: set/get/delete per task, nextOccurrence computation |
| `lib/activityFeedSubscriptionService.js` | ~280 | Push-webhook subscriptions: create/list/delete, dispatch with retry |

---

## New DB Migration

**Phase 43** (`db/migration_phase43.sql`) — 2 new tables + 5 new indexes:
- `workspace_task_recurrence_rules` — recurrence rule per workspace+task
  - `idx_wtrr_workspace`
  - `idx_wtrr_workspace_task`
  - `idx_wtrr_frequency`
- `workspace_activity_subscriptions` — push-webhook subscriptions per workspace
  - `idx_was_workspace_active`
  - `idx_was_workspace_created`

---

## New API Endpoints (7) — V169-T01 … V169-T07

### Block A — Task Recurrence Rules (T01–T03)
| Tag | Method | Path |
|---|---|---|
| V169-T01 | POST   | `/api/v1/workspaces/:id/tasks/:taskId/recurrence` |
| V169-T02 | GET    | `/api/v1/workspaces/:id/tasks/:taskId/recurrence` |
| V169-T03 | DELETE | `/api/v1/workspaces/:id/tasks/:taskId/recurrence` |

### Block B — Activity Feed Subscriptions (T04–T06)
| Tag | Method | Path |
|---|---|---|
| V169-T04 | POST   | `/api/v1/workspaces/:id/activity-subscriptions` |
| V169-T05 | GET    | `/api/v1/workspaces/:id/activity-subscriptions` |
| V169-T06 | DELETE | `/api/v1/workspaces/:id/activity-subscriptions/:subId` |

### Block C — Admin (T07)
| Tag | Method | Path |
|---|---|---|
| V169-T07 | GET | `/api/v1/admin/system/summary/v169` |

---

## Feature Details

### Task Recurrence Rules
- `setRecurrence(workspaceId, taskId, opts)` → `RecurrenceRule`
  - Frequencies: `daily` / `weekly` / `monthly`
  - `interval` (1–365), `until` (ISO date), `count` (1–1000)
  - Upsert semantics — replaces existing rule for same task
- `getRecurrence(workspaceId, taskId)` → `RecurrenceRule` (404 if absent)
- `deleteRecurrence(workspaceId, taskId)` → `{ deleted: true }`
- `nextOccurrence(fromDate?)` — computes next date; returns null if exhausted by `until`
- `listRecurrences(workspaceId)` — all rules in workspace

### Activity Feed Subscriptions
- `createSubscription(workspaceId, opts)` → `ActivitySubscription`
  - `targetUrl` — must be valid http/https URL
  - `eventTypes` — optional array; empty = subscribe to all events (wildcard)
  - Max 50 subscriptions per workspace (`SUBSCRIPTION_LIMIT_REACHED` 429)
- `listSubscriptions(workspaceId)` → `ActivitySubscription[]`
- `deleteSubscription(workspaceId, subId)` → `{ deleted: true }` (404 if absent)
- `dispatch(workspaceId, event)` → `DeliveryRecord[]`
  - Filters subscriptions by eventType match
  - Retry up to 3 attempts on HTTP failure
  - `DeliveryRecord`: `{ subscriptionId, eventType, attempts, delivered, deliveredAt, lastError }`

---

## Tests

| File | Tests | Status |
|---|---|---|
| `tests/v169.test.js` | 42 | ✓ PASS |
| `tests/v168.test.js` | 43 | ✓ PASS (regression) |

---

## Cumulative Metrics

| Metric | V168 | V169 |
|---|---|---|
| Server lines (`ecos-api-server.js`) | 13,008 | **13,184** |
| Total endpoints | 186 | **193** |
| Cumulative tests | ≥2,099 | **≥2,141** |
| DB migration phase | 42 | **43** |
| Total lib modules | ~56 | **~58** |

---

## Sacred Files

| File | MD5 | Status |
|---|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |

---

## Protocol Compliance

- ✓ R1 — Sacred files untouched (MD5 verified)
- ✓ R2 — Endpoint tags V169-T01…T07 monotonically increasing
- ✓ R3 — Full canonical ZIP (all dirs included)
- ✓ R4 — No prior endpoints renumbered
- ✓ R5 — All V168 tests pass (regression verified)
- ✓ R6 — Zero new external dependencies
- ✓ R7 — In-memory + DB dual persistence in new service files
- ✓ R8 — NODE_ENV=test export blocks in new lib files
- ✓ R9 — Handoff docs: CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL
- ✓ R10 — JSDoc blocks with version tags in all new lib files
- ✓ R12 — Audit trail append-only (unchanged)
