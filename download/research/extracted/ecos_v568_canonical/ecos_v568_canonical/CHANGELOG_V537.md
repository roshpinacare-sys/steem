# CHANGELOG V537 — activeHb532 Heartbeat Exposure

## תאריך
2026-06-05

## מה זוהה
`_hb532` (heartbeat singleton) נוצר ב-V532 IIFE ולא היה נגיש מחוץ לו.
`_hb532_534` ב-V534 IIFE לא הצליח לקרוא אותו (הערה בקוד: "not accessible").

## מה נבנה
**שינוי ב-`lib/heartbeatGovernanceBridge532.js`**:
- הוסף `let activeHb532 = null;` + getter/setter (אותו דפוס כמו `activeBridge532`)

**שינוי ב-`ecos-api-server.js`** (V532 IIFE):
- `_getOrCreate532` מוסיף: `try { Bridge532.activeHb532 = _hb532; } catch (_) {}`
- כך ש-POST /governance/start → `_getOrCreate532` → `activeHb532` מאוכלס

**IIFE V537**:
- `GET /api/v1/diamond/heartbeat/governance/status/v537` — מחזיר `hbLive`, `hbRunning`, `hbStatus`, `bridgeLive`, `bridgeStats`
- `GET /api/v1/admin/summary/v537`

## אימות
- `tests/v537.test.js` → **12/12 ✓**
- `scripts/audit-tests.js` → **pass=135, cannotRun=19, realFail=0** (לפני: 134/19/0)
- SACRED md5: intact | node --check: OK

## מה לא אומת
- 19 suites cannotRun (vitest/ESM) — לא ניתן לאמת כאן.
- `hbRunning: true` ייראה רק לאחר POST /governance/start ב-runtime חי.
