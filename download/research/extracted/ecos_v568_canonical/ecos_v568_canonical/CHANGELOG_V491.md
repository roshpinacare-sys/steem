# CHANGELOG_V491.md

## זוהה
- `lib/providerAdapters284.js` ייבא `./providerAdapters283` ישירות (ללא Canon shim)

## נבנה
- `lib/providerAdapters283Canon491.js` — Canon shim חדש לפי דפוס 282Canon490
  - מאצל ל-`providerAdapters283.js`; מוסיף `getCanonInfo491()`
  - מייצא: PROVIDER_CONTRACTS_283, validateProvider283/All, createTemplateBoundChannelStub283, createAllStubs283

## חובר
- `lib/providerAdapters284.js` עודכן → `./providerAdapters283Canon491.js`
- `ecos-api-server.js` IIFE V491:
  - `GET /api/v1/provider-adapters/283/canon/status`
  - `GET /api/v1/admin/summary/v491`

## שרשרת
...→280Canon488→281Canon489→282Canon490→**283Canon491**→V284+

## אימות
SACRED ✓ | parse ✓ | 11/11 exit 0
