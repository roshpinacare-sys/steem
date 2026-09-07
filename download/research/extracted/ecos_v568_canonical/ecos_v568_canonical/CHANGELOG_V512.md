# CHANGELOG V512 — sybilGuard Canon Facade

## תאריך
2026-06-05

## מה זוהה
- מגדל **sybilGuard**: 6 מודולים (V263–V268)
- V263–V267: כבר thin re-exports של V268 (parallel-dup, לא chain)
- V268: tip קנוני — composite humanity score, velocity detection,
  device fingerprint clustering, graduated responses (ALLOW/WARN/THROTTLE/BLOCK)
- 10 signal weights, AMNESTY_RETENTION=15%, VELOCITY_MAX=60/min

## מה נבנה
- **`lib/sybilGuardCanon512.js`** + **`src/lib/sybilGuardCanon512.js`**
  - `getCanonInfo512()` — metadata: 6 מודולים, tip=V268
  - `getHealthSummary512()` — health snapshot: instance OK, 10 signals
  - `createInstance512(opts)` — new SybilGuard268 (canonical entrypoint)
  - `registerEndpoints512(app)` — wire status endpoint
  - Re-export מלא של V268 API (backwards-compatible)

## מה חובר
- `GET /api/v1/sybil-guard/canon/status` — health snapshot
- `GET /api/v1/admin/summary/v512`

## אימות
- `node --check` → PARSE OK
- `tests/v512.test.js` → **10/10** (exit 0)
- `scripts/audit-tests.js` → **pass=58, cannotRun=72, realFail=0** (58 vs 57 — +1 חדש)
- SACRED md5: `563e9b1f...` / `e5a5c2c2...` — intact

## מה לא אומת
- 72 suites cannotRun (vitest/ESM) — לא ניתן לאמת כאן, לא ידועים ככשל
- endpoint לא נבדק ב-HTTP אמיתי (אין supertest/express בסביבה)
