# CHANGELOG V511 — telemetry Canon Facade

## תאריך
2026-06-05

## מה זוהה
מגדל **telemetry**: 6 מודולים (V263–V268).
V263–V267 היו כבר thin re-exports ל-V268 (parallel-dup). ללא facade מאחד.

## מה נבנה
**`lib/telemetryCanon511.js`** (+ `src/lib/`):
- `getCanonInfo511()` — metadata: tower, 6 מודולים, guidance לייבוא
- `getHealthSummary511()` — snapshot חי דרך `checkTelemetryHealth268`
- `defaultTelemetry511()` — singleton קנוני Telemetry268
- `registerEndpoints511(app)` — wire ל-express
- Re-export מלא של Telemetry268 + defaultTelemetry268

## מה חובר
- `GET /api/v1/telemetry/canon/status` — health snapshot
- `GET /api/v1/admin/summary/v511`

## אימות
- `node --check ecos-api-server.js` → OK
- `NODE_ENV=test node tests/v511.test.js` → **10/10 ✓**
- `node scripts/audit-tests.js` → pass=57, cannotRun=72, **realFail=0**
- SACRED md5: intact

## מה לא אומת
- 72 suites cannotRun (vitest/ESM) — לא ניתן לאמת כאן, לא נחשבים כשל.
- endpoints /telemetry/canon/status לא נבדקו עם HTTP חי (אין supertest/express בסביבה זו).
