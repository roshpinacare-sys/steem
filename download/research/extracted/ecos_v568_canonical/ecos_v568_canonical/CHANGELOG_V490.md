# CHANGELOG_V490.md

## זוהה
- `lib/providerAdapters283.js` ייבא `./providerAdapters282` ישירות (ללא Canon shim)
- V282 לא היה מקושר בשרשרת הקנונית — קו notificationTemplate לא ניתן-לעקוב

## נבנה
- `lib/providerAdapters282Canon490.js` — Canon shim לפי דפוס 281Canon489
  - מאצל ל-`providerAdapters282.js` (original נשמר)
  - מוסיף `getCanonInfo490()` עם metadata
  - מייצא surface זהה: PROVIDER_CONTRACTS_282/281, validateProvider282,
    validateAllProviders282, createNotificationTemplateStub282, createAllStubs282

## חובר
- `lib/providerAdapters283.js`: שורת `require` עודכנה ל-`./providerAdapters282Canon490.js`
- `ecos-api-server.js`: IIFE V490 עם:
  - `GET /api/v1/provider-adapters/282/canon/status`
  - `GET /api/v1/admin/summary/v490`

## שרשרת עכשיו
275Canon483→276Canon484→277Canon485→278Canon486→279Canon487→280Canon488→281Canon489→**282Canon490**→V283+

## אימות
- SACRED md5: ✓
- `node --check`: ✓
- `NODE_ENV=test node tests/v490.test.js`: 11/11 exit 0
