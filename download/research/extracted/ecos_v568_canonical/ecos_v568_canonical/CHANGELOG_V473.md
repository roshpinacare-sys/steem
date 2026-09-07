# CHANGELOG_V473.md — agentDispatchBridge Canon Facade

## מה זוהה
מגדל `agentDispatchBridge` עם 8 גרסאות (V246–V253), ללא facade קנונית וללא ייבוא בשרת.
V253 הוא ה-tip עם המשטח המלא (retry, quota, snapshot, diff-apply, stats).

## מה נבנה
`lib/agentDispatchBridgeCanon473.js` + `src/lib/agentDispatchBridgeCanon473.js`

facade קנונית המקבצת את כל 8 הגרסאות תחת entry-point אחד:
- מייצא את משטח V253 המלא
- מחשף את factory הבסיסי `createDispatchBridge246` מ-V246
- `getCanonInfo473()` — מטה-דאטה על ה-tower
- Soft-require על V246 (fail-safe אם חסר)

## מה חובר
IIFE `_wireAgentDispatchBridgeCanon473` בסוף השרת:
- `GET /api/v1/agent/dispatch/canon/status` — מצב ה-tower + metadata
- `GET /api/v1/admin/summary/v473` — תיאור ה-feature

## SACRED
- `fiatLedger.js`: `563e9b1f9e67091a5b6527c0a92568e5` ✅
- `auditLog.js`:   `e5a5c2c27801d2d03991bc8e5a1df8cb` ✅

## אימות
`NODE_ENV=test node tests/v473.test.js` — **10/10 ✅**
Zero new npm deps.
