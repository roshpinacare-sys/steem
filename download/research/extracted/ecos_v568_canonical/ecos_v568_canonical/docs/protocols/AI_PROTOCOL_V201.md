# AI_PROTOCOL_V201.md
Version: 201.0.0 | Phase: P90 | Date: 2026-05-31

## New in V201
- V201-T01: `GET /workspaces/:id/events/digest/co-active?windowSec=N`
- V201-T02: `GET /workspaces/:id/events/digest/heatmap`
- V201-T03: `GET /api/v1/admin/summary/v201`

## Constants (suffixed 201)
- `V201_CO_ACTIVE_DEFAULT_SEC201 = 60`
- `V201_CO_ACTIVE_MAX_SEC201 = 3600`
- `V201_CO_ACTIVE_MAX_PAIRS201 = 200`
- `V201_HEATMAP_HOURS201 = 24`

## Test exports (NODE_ENV=test)
`V201_CO_ACTIVE_DEFAULT_SEC`, `V201_CO_ACTIVE_MAX_SEC`, `V201_CO_ACTIVE_MAX_PAIRS`, `V201_HEATMAP_HOURS`

## Sacred files: UNTOUCHED
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5`
- `lib/auditLog.js`   MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb`
