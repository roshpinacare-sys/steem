# AI_PROTOCOL_V200.md — V200 (Phase P89)

## Endpoints Added
- V200-T01: GET /api/v1/workspaces/:id/events/digest/top-senders
- V200-T02: GET /api/v1/workspaces/:id/events/digest/type-distribution
- V200-T03: GET /api/v1/admin/summary/v200

## Reused Stores
- `_eventLog181` — no new stores introduced

## Constants (200-suffixed)
- V200_TOP_SENDERS_MAX200 = 100
- V200_TOP_SENDERS_DEFAULT200 = 10
- V200_TYPE_DIST_MAX200 = 200

## Sacred Files
- lib/fiatLedger.js — MD5: 563e9b1f9e67091a5b6527c0a92568e5 — UNTOUCHED
- lib/auditLog.js   — MD5: e5a5c2c27801d2d03991bc8e5a1df8cb — UNTOUCHED

## Tests: 36 passing (v200.test.js)
