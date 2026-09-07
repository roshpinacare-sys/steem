# CHANGELOG_V492.md

## זוהה
- `lib/providerAdapters285.js` ייבא `./providerAdapters284` ישירות (ללא Canon shim)

## נבנה
- `lib/providerAdapters284Canon492.js` — Canon shim לפי דפוס 283Canon491
  - מאצל ל-`providerAdapters284.js`; מוסיף `getCanonInfo492()`
  - מייצא: PROVIDER_CONTRACTS_284, validateProvider284/All, createChannelFilterStub284, createAllStubs284

## חובר
- `lib/providerAdapters285.js` עודכן → `./providerAdapters284Canon492.js`
- `ecos-api-server.js` IIFE V492:
  - `GET /api/v1/provider-adapters/284/canon/status`
  - `GET /api/v1/admin/summary/v492`

## שרשרת
...→281Canon489→282Canon490→283Canon491→**284Canon492**→V285+

## אימות
SACRED ✓ | parse ✓ | 11/11 exit 0
