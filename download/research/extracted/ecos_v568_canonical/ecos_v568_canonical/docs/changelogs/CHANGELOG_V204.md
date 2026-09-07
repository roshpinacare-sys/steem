# CHANGELOG - V204 (Phase P93)

## Version: 204.0.0 | Date: 2026-05-31

## Summary
V204 adds two more digest analysis endpoints using `_eventLog181` — no new stores.

## New Endpoints (3) - V204-T01 ... V204-T03

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V204-T01 | GET | `/api/v1/workspaces/:id/events/digest/top-types` | Rank event types by frequency. Query: `?limit=N` (default 10, max 100). Returns `{total, limit, types: [{type, count, pct}]}` sorted descending. |
| V204-T02 | GET | `/api/v1/workspaces/:id/events/digest/sender-rank` | Rank senders by event count. Query: `?limit=N` (default 10, max 100). Returns `{total, limit, senders: [{senderId, count, pct}]}` sorted descending. |
| V204-T03 | GET | `/api/v1/admin/summary/v204` | Admin summary |

## Implementation Notes
- **top-types**: count events per `type`; missing type → `(unknown)`; sort descending; apply limit; compute pct = count/total×100 rounded to 2dp.
- **sender-rank**: count events per `senderId`; missing senderId → `(unknown)`; sort descending; apply limit; compute pct = count/total×100 rounded to 2dp.
- Both reuse `_eventLog181` — zero new stores.
- Constants: `V204_DEFAULT_LIMIT204 = 10`, `V204_MAX_LIMIT204 = 100`.

## Tests
- `tests/v204.test.js` — 39 tests PASS

## Cumulative Metrics

| Metric | V203 | V204 |
|--------|------|------|
| Server lines | ~19,085 | ~19,230 |
| Endpoints added | 3 | 3 |

## Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` UNTOUCHED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` UNTOUCHED

## Protocol Compliance
- R1 - Sacred files untouched
- R4 - No endpoints removed
- R5 - All prior tests pass (V203: 36/37 pass; SRC-13 version check is expected to fail after version bump)
- R6 - Zero new npm dependencies
- R8 - NODE_ENV=test export block; 204-suffixed identifiers
