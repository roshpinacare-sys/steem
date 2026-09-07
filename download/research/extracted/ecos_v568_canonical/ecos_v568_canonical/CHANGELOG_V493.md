# CHANGELOG_V493.md

## זוהה
- `lib/providerAdapters286.js` ייבא `./providerAdapters285` ישירות (ללא Canon shim)

## נבנה
- `lib/providerAdapters285Canon493.js` — Canon shim לפי דפוס 284Canon492
  - מאצל ל-`providerAdapters285.js`; מוסיף `getCanonInfo493()`
  - מייצא: PROVIDER_CONTRACTS_285, validateProvider285/All, createFilterPresetsStub285, createAllStubs285

## חובר
- `lib/providerAdapters286.js` עודכן → `./providerAdapters285Canon493.js`
- `ecos-api-server.js` IIFE V493:
  - `GET /api/v1/provider-adapters/285/canon/status`
  - `GET /api/v1/admin/summary/v493`

## שרשרת
...→282Canon490→283Canon491→284Canon492→**285Canon493**→V286+

## אימות
SACRED ✓ | parse ✓ | 11/11 exit 0
