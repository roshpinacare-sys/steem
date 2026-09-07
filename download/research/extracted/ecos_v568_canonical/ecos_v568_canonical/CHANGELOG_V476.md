# CHANGELOG V476 — providerAdapters Canon Facade

## תאריך
2026-06-05

## מה זוהה
- מגדל **providerAdapters**: 17 מודולים (V267–V286) ללא facade מאחד
- 36 contracts, validation, stub factories — כולם מפוזרים על 17 גרסאות
- המגדל הגדול השני (אחרי marketMaker שאוחד ב-V475)

## מה נבנה
- **`lib/providerAdaptersCanon476.js`** (+ `src/lib/providerAdaptersCanon476.js`)
  - Canonical facade לכל המגדל (V267–V286)
  - `getCanonInfo476()` — metadata: tower, moduleCount(17), contractCount(36)
  - `getHealthSummary476()` — snapshot חי: stubs OK, validation OK, contract keys
  - `validateProvider476()` — canonical entrypoint לvalidation
  - `validateAllProviders476()` — validate כל ה-providers בבת אחת
  - `createAllStubs476()` — כל 36 stubs דרך canonical
  - `registerEndpoints476(app)` — wire ל-express
  - Re-export מלא של V286 API (backwards-compatible)

## מה חובר
- `GET /api/v1/provider-adapters/canon/status` — health snapshot
- `GET /api/v1/admin/summary/v476` — summary

## אימות
- `node --check ecos-api-server.js` → OK
- `NODE_ENV=test node tests/v476.test.js` → **11/11 ✓**
- SACRED md5: `563e9b1f...` / `e5a5c2c2...` — intact
