# CHANGELOG_V489.md

## זוהה
- `lib/providerAdapters282.js` ייבא `./providerAdapters281` ישירות (ללא Canon shim)
- הפגיעה: V282 לא מקושר בשרשרת הקנונית — קו 281 לא נמדד/ניתן-לעקוב

## נבנה
- `lib/providerAdapters281Canon489.js` — Canon shim לפי דפוס 280Canon488
  - מאצל ל-`providerAdapters281.js` (original נשמר)
  - מוסיף `getCanonInfo489()` עם metadata
  - מייצא surface זהה: PROVIDER_CONTRACTS_281, validateProvider281, validateAllProviders281,
    createDigestSchedulerStub281, createAllStubs281

## חובר
- `lib/providerAdapters282.js`: שורת `require` עודכנה ל-`./providerAdapters281Canon489.js`
- `ecos-api-server.js`: IIFE V489 עם:
  - `GET /api/v1/provider-adapters/281/canon/status`
  - `GET /api/v1/admin/summary/v489`

## שרשרת עכשיו
275Canon483→276Canon484→277Canon485→278Canon486→279Canon487→280Canon488→**281Canon489**→V282

## אימות
- SACRED md5: ✓  
- `node --check`: ✓  
- `NODE_ENV=test node tests/v489.test.js`: 11/11 exit 0
