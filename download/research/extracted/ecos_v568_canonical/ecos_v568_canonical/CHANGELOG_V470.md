# CHANGELOG V470

## זוהה
- מגדל `meshDispatcher` (10 מודולים: D288-D297) — שרשרת require ללא canonical facade
- אין נקודת כניסה מוגדרת לקוד חדש → סיכון ייבוא ישיר של גרסאות ביניים

## נבנה / חובר
- **`lib/meshDispatcherCanon470.js`** + **`src/lib/meshDispatcherCanon470.js`** (mirror):
  - Canonical facade המצהיר על D297 כ-tip קנוני של המגדל
  - מייצא את משטח D297 המלא + `getCanonInfo470()` metadata
  - כל קוד חדש יבוא מכאן בלבד
- **IIFE V470** ב-`ecos-api-server.js`:
  - `GET /api/v1/mesh/dispatch/canonical` — מחזיר מידע tower canon
  - `GET /api/v1/admin/summary/v470` — meta summary עם guidance
- **`tests/v470.test.js`** — 10 טסטים: SACRED md5, parse, version, facade, endpoints

## אימות
- `node --check ecos-api-server.js` → OK
- SACRED md5: fiatLedger ✓ auditLog ✓
- `NODE_ENV=test node tests/v470.test.js` → 10/10 exit 0

## לא שונה
- D288-D297 — ללא שינוי (שרשרת קיימת בשלמותה)
- IIFEs קיימים בשרת — ללא שינוי
- SACRED files — ללא מגע
