# CHANGELOG V475 — marketMaker Canon Facade

## תאריך
2026-06-05

## מה זוהה
- מגדל **marketMaker**: 36 גרסאות (V298–V333) ללא facade מאחד
- הגרסה הגדולה ביותר — 36 מודולים — קדמה לכל שאר המגדלים הפתוחים

## מה נבנה
- **`lib/marketMakerCanon475.js`** (+ `src/lib/marketMakerCanon475.js`)
  - Canonical facade לכל המגדל
  - `getCanonInfo475()` — metadata על 36 המודולים
  - `getHealthSummary475()` — snapshot חי של 4 ה-instances הקנוניים
  - `defaultAuditTrail475()` — singleton של AuditCapTrail333
  - `registerEndpoints475(app)` — wire ל-express
  - Re-export מלא של כל ייצוא V333

## מה חובר
- `GET /api/v1/market-maker/canon/status` — health snapshot
- `GET /api/v1/admin/summary/v475` — summary

## אימות
- `node --check ecos-api-server.js` → OK
- `NODE_ENV=test node tests/v475.test.js` → **11/11 ✓**
- SACRED md5: intact
