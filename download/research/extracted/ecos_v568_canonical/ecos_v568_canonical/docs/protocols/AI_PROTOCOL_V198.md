# AI_PROTOCOL_V198.md — V198 (Phase P87)

## Endpoints Added
- V198-T01: GET /api/v1/workspaces/:id/events/digest/sender-timeline/:senderId
- V198-T02: GET /api/v1/workspaces/:id/events/digest/bursts
- V198-T03: GET /api/v1/admin/summary/v198

## Reused Stores
- `_eventLog181` — no new stores introduced

## Constants (198-suffixed)
- V198_TIMELINE_MAX198 = 500
- V198_BURST_WINDOW_MIN198 = 1
- V198_BURST_WINDOW_MAX198 = 3600
- V198_BURST_RESULTS_MAX198 = 100
- V198_BURST_THRESHOLD_DEFAULT198 = 2

## Sacred Files
- lib/fiatLedger.js — MD5: 563e9b1f9e67091a5b6527c0a92568e5 — UNTOUCHED
- lib/auditLog.js   — MD5: e5a5c2c27801d2d03991bc8e5a1df8cb — UNTOUCHED

## Tests: 36 passing (v198.test.js)
