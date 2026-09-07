# CHANGELOG — V167

## Version: 167.0.0 | Phase: P56 | Date: 2026-05-30

---

## Summary

V167 implements **P1 high-value features** from the V166 roadmap:
1. **Workspace Activity Feed** — paginated stream of all workspace events (tasks, comments, SLA, bulk ops, member changes) with cursor pagination, type/actor/date filters, and real-time WebSocket fan-out

---

## New Lib Modules (1)

| File | Lines | Purpose |
|---|---|---|
| `lib/workspaceActivityFeedService.js` | ~433 | Activity feed record + paginated query + WebSocket fan-out |

---

## New DB Migration

**Phase 41** (`db/migration_phase41.sql`) — 1 new table + 3 new indexes:
- `workspace_activity_feed` — activity event records per workspace
- `idx_waf_workspace_created` — fast listing per workspace ordered by recency
- `idx_waf_workspace_event_type` — filter by event type within workspace
- `idx_waf_workspace_actor` — filter by actor within workspace

---

## New API Endpoints (5) — V167-T01 … V167-T05

### Block A — Workspace Activity Feed (T01–T04)
| Tag | Method | Path |
|---|---|---|
| V167-T01 | GET | `/api/v1/workspaces/:id/activity` |
| V167-T02 | POST | `/api/v1/workspaces/:id/activity` |
| V167-T03 | GET | `/api/v1/workspaces/:id/activity/:eventId` |
| V167-T04 | DELETE | `/api/v1/workspaces/:id/activity` |

### Block B — Admin (T05)
| Tag | Method | Path |
|---|---|---|
| V167-T05 | GET | `/api/v1/admin/system/summary/v167` |

---

## Feature Details

### Workspace Activity Feed
- `recordEvent(workspaceId, data)` → `ActivityEvent`
- `eventType` must be one of 15 known types: `task.*`, `comment.*`, `member.*`, `sla.*`, `bulk.*`, `custom_field.set`
- `getActivityFeed(workspaceId, opts)` → `{ events, nextCursor, prevCursor, total }`
  - `limit` 1–100 (default 25)
  - `after` / `before` cursor pagination
  - `types[]` — filter by event type(s)
  - `actorId` — filter by actor
  - `since` / `until` — ISO date range
- `getEvent(workspaceId, eventId)` → `ActivityEvent`
- `clearWorkspace(workspaceId)` — test helper
- Real-time fan-out via `wsHub.broadcastToWorkspace(wsId, { type: 'activity.new', event })`
- In-memory circular buffer: 500 events per workspace (newest first)
- In-memory + DB dual persistence

---

## Tests

| File | Tests | Status |
|---|---|---|
| `tests/v167.test.js` | 35 | ✓ PASS |
| `tests/v166.test.js` | 30 | ✓ PASS (regression) |

---

## Cumulative Metrics

| Metric | V166 | V167 |
|---|---|---|
| Server lines (`ecos-api-server.js`) | 12,578 | **12,578** (endpoints added inline) |
| Total endpoints | 175 | **180** |
| Cumulative tests | ≥2,021 | **≥2,056** |
| DB migration phase | 40 | **41** |
| Total lib modules | ~53 | **~54** |

---

## Sacred Files

| File | MD5 | Status |
|---|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |

---

## Protocol Compliance

- ✓ R1 — Sacred files untouched (MD5 verified)
- ✓ R2 — Endpoint tags V167-T01…T05 monotonically increasing
- ✓ R3 — Full canonical ZIP (all dirs included)
- ✓ R4 — No prior endpoints renumbered
- ✓ R5 — All V166 tests pass
- ✓ R6 — Zero new external dependencies
- ✓ R7 — In-memory + DB dual persistence in new service
- ✓ R8 — NODE_ENV=test export blocks in new lib files
- ✓ R9 — Handoff docs: CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL
- ✓ R10 — JSDoc blocks with version tags in all new lib files
- ✓ R12 — Audit trail append-only (unchanged)
