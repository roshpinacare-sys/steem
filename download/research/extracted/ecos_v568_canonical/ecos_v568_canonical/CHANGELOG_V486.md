# CHANGELOG_V486.md — providerAdapters278Canon486 Shim

## מה זוהה
V279 ייבא `providerAdapters278` ישירות, מחוץ לשרשרת ה-shim.
NEXT_SESSION_PROMPT_V485 הצביע על כך במפורש.

## מה נבנה
`lib/providerAdapters278Canon486.js` + mirror ב-`src/lib/`

shim קנוני שמאריך את שרשרת ה-mediators:
- מאציל ל-`providerAdapters278.js` (המקור נשמר)
- מייצא משטח זהה: `PROVIDER_CONTRACTS_278`, `validateProvider278`, `validateAllProviders278`, `createAlertSlaStub278`, `createAllStubs278`
- מוסיף `getCanonInfo486()` — מטה-דאטה על השרשרת

## מה חובר
- `lib/providerAdapters279.js` + `src/lib/` עודכנו: `require('./providerAdapters278')` → `require('./providerAdapters278Canon486')`
- IIFE `_wireProviderAdapters278Canon486` בשרת:
  - `GET /api/v1/providers/canon/278/status`
  - `GET /api/v1/admin/summary/v486`

## שרשרת מלאה
`275Canon483 → 276Canon484 → 277Canon485 → 278Canon486 → V279+`

## SACRED
- `fiatLedger.js`: `563e9b1f9e67091a5b6527c0a92568e5` ✅
- `auditLog.js`:   `e5a5c2c27801d2d03991bc8e5a1df8cb` ✅

## אימות
`NODE_ENV=test node tests/v486.test.js` — **10/10 ✅**
