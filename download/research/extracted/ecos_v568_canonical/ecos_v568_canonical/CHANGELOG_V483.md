# CHANGELOG V483

## זוהה
- מגדל `providerAdapters` (V267-V286) — V276 מייבא V275 ישירות ללא שכבת canon
- 0 הפניות חיצוניות ל-V274 (מחוץ ל-275)

## נבנה / חובר
- **`lib/providerAdapters275Canon483.js`** + **`src/lib/`** (mirror):
  - Delegation shim: מייצא את אותו surface כמו V275 + `getCanonInfo483()`
  - V276 מייבא ממנו במקום מ-275 ישירות
  - אין circular dependency — שומר את השרשרת 273→274→275 שלמה
- **`lib/providerAdapters276.js`** — עדכון שני require: `./providerAdapters275` → `./providerAdapters275Canon483`
- **IIFE V483** בשרת:
  - `GET /api/v1/towers/providers/chain-v483` — chain map עם אנוטציה של שכבת shim
  - `GET /api/v1/admin/summary/v483` — meta summary
- **`tests/v483.test.js`** — 10 טסטים

## אימות
- `node --check ecos-api-server.js` → OK
- SACRED md5: fiatLedger ✓ auditLog ✓
- Canon476 `getHealthSummary476()` → healthy, 36 contracts
- `NODE_ENV=test node tests/v483.test.js` → **10/10 exit 0**

## לא שונה
- V267, V268, V269, V273, V274, V275 — ללא מגע (שרשרת בסיס שלמה)
- SACRED files — ללא מגע
- IIFEs קיימים — ללא מגע
