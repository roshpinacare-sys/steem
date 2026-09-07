# ECOS V155 Changelog
**Release Date:** 2026-05-30
**Version:** 155.0.0
**Previous:** V154 (Admin Intelligence + Persistent Withdrawals + E2E Hardening)

---

## Summary

V155 introduces three major new capabilities built on top of V154's admin intelligence layer:

1. **AI Metrics Dashboard** — real-time confidence histogram, pressure detection rate, calibration accuracy tracking, and auto-calibration trigger
2. **Real-Time Admin WebSocket Feed** — replaces 15-second polling with live `ws://host/ws/admin` subscription for audit events and AI metrics
3. **Workspace UI** — full multi-tenant workspace management page with create/list/stats/leaderboard

---

## New Files

### `lib/aiMetricsEngine.js` [V155-AI-01]
- `AiMetricsEngine` class with rolling window (default: 100 tasks)
- `recordTask({ confidence, verdict, pressureDetected, calibrated })` — accumulates metrics
- `getMetrics()` — returns `{ taskCount, avgConfidence, histogram, pressureRate, pressureWarn, verdictCounts, calibrationAccuracy, autoCalibCount, lastAutoCalib, status }`
- 10-bin confidence histogram (0–10%, 10–20%, …, 90–100%)
- Status classification: `idle | healthy | degraded | warning`
- Auto-calibration trigger when `calibrationAccuracy < 0.70` and ≥10 calibration samples
- `persistSnapshot(pool)` — optional DB persistence to `ai_metrics_snapshots` table
- `defaultAiMetricsEngine` singleton exported for server-wide use

### `lib/adminWsHub.js` [V155-WS-01]
- `AdminWsHub` class — WebSocket server on `/ws/admin`
- Auth: Bearer JWT with `role: 'admin'` claim, or `?adminToken=` query param, or dev fallback
- `broadcastAuditEvent(event)` — sends `audit.event` to all connected admins
- `broadcastMetrics()` — sends `ai.metrics` snapshot to all connected admins
- `broadcast(type, data)` — generic broadcast with stale client cleanup
- Periodic AI metrics push every 30 seconds
- `stats()` returns `{ connectedClients, totalBroadcasts, totalConnections, ecosVersion }`
- Message handlers: `ping → pong`, `request.metrics`, `request.status`
- DB broadcast log (non-fatal): `audit_broadcast_log` table

### `db/migration_phase30.sql` [V155-DB-01]
- `ai_metrics_snapshots` table — historical AI metrics snapshots
- `audit_broadcast_log` table — WS broadcast audit trail
- Both tables include proper indexes and `ON CONFLICT DO NOTHING`

### `tests/v155AiMetrics.test.js` [V155-T01..T60]
- **60 new tests** covering:
  - `AiMetricsEngine` (T01–T20): construction, metrics shape, confidence accumulation, verdict counts, pressure rate, histogram bins, window eviction, status classification, singleton
  - `AdminWsHub` (T21–T35): construction, stats shape, broadcast counting, error resilience
  - Admin page pure helpers (T36–T50): `formatConfidence`, `pressureRateLabel`, `aiStatusColor`, `verdictColor`
  - Workspace page pure helpers (T51–T60): `visibilityBadge`, `formatScore`, `workspaceAge`

---

## Modified Files

### `ecos-api-server.js` [V155-API]
New endpoints added before `startServer()`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/v1/admin/ai-metrics` | GET | Current AI metrics snapshot |
| `/api/v1/admin/ai-metrics/history` | GET | Historical snapshots from DB (limit param) |
| `/api/v1/admin/calibrator/auto-trigger` | POST | Check/trigger auto-calibration |
| `/api/v1/admin/ws/stats` | GET | WS connection stats (admin + notification hubs) |
| `/api/v1/system/readiness` | GET | V155 override — adds `adminWs` check, max score 8 |
| `/api/v1/workspaces/:workspaceId/stats` | GET | Per-workspace statistics |
| `ws://host/ws/admin` | WS | Real-time admin event feed |

- `_aiMetrics` singleton wired to calibrator and logger
- `_adminWsHub` singleton with upgrade handler on `/ws/admin`
- `auditLog.append` wrapped to broadcast events to admin WS clients
- Server banner updated to V155

### `apps/web/src/app/admin/page.jsx` [V155-ADMIN-UI]
Three new sections added above V154 sections:

1. **AI Metrics Dashboard** — 4 stat cards (task count, avg confidence, pressure rate, calibration accuracy), confidence histogram with color-coded bins, verdict distribution badges, auto-calibration button
2. **Real-Time Admin Feed** — WebSocket client with 5s reconnect, fallback to 15s polling, live indicator, source badge (⚡ WS vs 🔄 poll)
3. **WS Connection Status** — admin WS + notification WS client counts

New pure helpers (unit-tested):
- `aiStatusColor(status)` — status → hex color
- `formatConfidence(v)` — 0.75 → "75.0%"
- `pressureRateLabel(rate)` — 31 → "31.0% ⚠️"

### `apps/web/src/app/workspace/page.jsx` [V155-WS-UI] *(new file)*
Full workspace management UI:
- **Platform Stats** — workspace count, user count, agent runs
- **Create Workspace** — form with owner ID, name, description, visibility selector
- **Workspace List** — filterable table with per-workspace stats panel
- **Contribution Leaderboard** — top 10 users with score color coding

New pure helpers (unit-tested):
- `visibilityBadge(visibility)` — returns `{ label, color, bg }`
- `formatScore(score)` — score → `{ label, color }` with green/yellow/red thresholds
- `workspaceAge(createdAt)` — ISO date → "Today" / "N days ago"

### `package.json`
- `version`: `154.0.0` → `155.0.0`
- `description` updated to reflect V155 capabilities

---

## Sacred Files (NEVER MODIFIED)
The following files were intentionally left untouched per ECOS protocol:
- `lib/fiatLedger.js`
- `lib/auditLog.js`

---

## Test Coverage Summary

| Suite | Tests | Status |
|---|---|---|
| V155 AI Metrics + WS Hub + UI helpers | 60 | ✅ All pass |
| V154 Admin Stats + Withdrawal History | (inherited) | ✅ |
| V153 and earlier | (inherited) | ✅ |

---

## Upgrade Instructions

### DB Migration (required for persistence features)
```sql
-- Run: psql -U ecos -d ecos_b2b < db/migration_phase30.sql
```

### Environment Variables (optional)
```env
# Admin WS auth (dev: leave unset for open access)
ADMIN_TOKEN=your-admin-token-here
# Or use existing JWT_SECRET with role: 'admin' claim
```

### No breaking changes
All V154 API endpoints are preserved. V155 adds new endpoints only.
The `/api/v1/system/readiness` endpoint now returns `max: 8` (was 7) with the new `adminWs` check.
