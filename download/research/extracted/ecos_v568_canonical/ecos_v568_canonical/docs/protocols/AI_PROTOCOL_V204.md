# AI_PROTOCOL_V204.md
Version: 204.0.0 | Phase: P93 | Date: 2026-05-31

## New in V204
- V204-T01: `GET /api/v1/workspaces/:id/events/digest/top-types?limit=N`
- V204-T02: `GET /api/v1/workspaces/:id/events/digest/sender-rank?limit=N`
- V204-T03: `GET /api/v1/admin/summary/v204`

## Constants (suffixed 204)
- `V204_DEFAULT_LIMIT204 = 10`
- `V204_MAX_LIMIT204 = 100`

## Test exports (NODE_ENV=test)
`V204_DEFAULT_LIMIT`, `V204_MAX_LIMIT`

## Sacred files: UNTOUCHED
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5`
- `lib/auditLog.js`   MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb`
