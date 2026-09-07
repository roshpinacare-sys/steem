# CHANGELOG — V200 (Phase P89)

## Version: 200.0.0 | Date: 2026-05-31

## Summary
V200 adds two digest analysis endpoints (top senders + event type distribution) using the existing `_eventLog181` store — no new stores introduced.

## New Endpoints (3) — V200-T01 … V200-T03

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V200-T01 | GET | `/api/v1/workspaces/:id/events/digest/top-senders` | Rank senders by total event count. Query: `?limit=N` (default 10, max 100). Returns `[{senderId, count, firstSeen, lastSeen}]` desc |
| V200-T02 | GET | `/api/v1/workspaces/:id/events/digest/type-distribution` | Count events by type across all senders. Returns `[{type, count, pct}]` sorted by count desc |
| V200-T03 | GET | `/api/v1/admin/summary/v200` | Admin summary |

## Implementation Notes
- **top senders**: scans all events in `_eventLog181` for the workspace; groups by senderId; tracks count, firstSeen, lastSeen; sorts desc by count; capped at `limit` (max 100).
- **type distribution**: groups all events by `type`; computes pct as `Math.round((count/total)*10000)/100`; sorted desc by count; capped at 200.
- Both endpoints reuse `_eventLog181` — zero new stores.

## Tests
- `tests/v200.test.js` — 36 tests ✓ PASS
- `tests/v199.test.js` — 35/36 pass (SRC-14 version check expected; all logic tests pass)

## Cumulative Metrics

| Metric | V199 | V200 |
|--------|------|------|
| Server lines | 18,397 | 18,544 |
| Endpoints added this version | 3 | 3 |

## Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNTOUCHED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNTOUCHED

## Protocol Compliance
- ✓ R1 — Sacred files untouched
- ✓ R4 — No endpoints removed
- ✓ R5 — All prior logic tests pass
- ✓ R6 — Zero new npm dependencies
- ✓ R8 — NODE_ENV=test export block; 200-suffixed identifiers
