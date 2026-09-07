# CHANGELOG_V534.md — governanceHealthGate534

## מה זוהה
NEXT_SESSION_PROMPT_V533 הצביע על הפער: כאשר `snap.ok===false`, endpoint V532 מחזיר sentinel ללא הסבר. כדי לדעת *למה* — נדרשת קריאה שנייה ל-V533/diagnose. שני round-trips.

## מה נבנה
`lib/governanceHealthGate534.js` + `src/lib/governanceHealthGate534.js`

`buildHealthReport534(opts)` — מאחד:
- **snapshot** (`bridge532.getSnapshot()`) — מה המצב הנוכחי
- **diagnose** (`diagnoseBridgeOpts533`) — *למה* נכשל (רק כשצריך)
- **stats** (`bridge532.stats()`) — מונים
- **hbRunning** — האם הלב פועל

לוגיקת `enriched`: אם `snap.ok===false` **או** `snapshotsFailed>0` → diagnose מצורף אוטומטית.
`level`: `'healthy' | 'degraded' | 'unavailable'` עם `reason` מפורש.

## מה חובר
IIFE `_wireGovernanceHealthGate534`:
- `GET /api/v1/diamond/heartbeat/governance/health` — unified view (V534-T01)
- `GET /api/v1/admin/summary/v534` (V534-T02)

## אימות
- `NODE_ENV=test node tests/v534.test.js`: **13/13 ✅**
- `node scripts/audit-tests.js` לפני: 131 pass, 0 realFail
- `node scripts/audit-tests.js` אחרי: **132 pass, 19 cannotRun, 0 realFail** ✅

## מה לא אומת
- 19 cannotRun (vitest/ESM) — לא ניתן לאמת בסביבה זו
- `_hb532_534` = null בתוך ה-IIFE — heartbeat singleton לא נגיש מחוץ ל-IIFE של V532; `hbRunning` יחזיר false בתגובה (שמרני)

## SACRED
- `fiatLedger.js`: `563e9b1f9e67091a5b6527c0a92568e5` ✅
- `auditLog.js`:   `e5a5c2c27801d2d03991bc8e5a1df8cb` ✅
