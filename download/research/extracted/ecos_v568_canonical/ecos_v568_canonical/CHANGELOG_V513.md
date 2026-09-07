# CHANGELOG V513

## מה זוהה
מגדל `reputationLedger` — 6 מודולים (V263–V268), ללא Canon facade.
V263–V267 הם thin re-exports → V268 (parallel-dup, לא inheritance-chain).
V268 כולל: multi-dimensional reputation tracks, temporal decay (Ebbinghaus 90 days),
selective disclosure, program-level reputation, anti-collusion graph analysis.

## מה נבנה
**`lib/reputationLedgerCanon513.js`** — Canon Facade:
- `getCanonInfo513()` — metadata על המגדל
- `getHealthSummary513()` — health check חי (tipOk, instanceOk, health detail)
- `createInstance513(opts)` — יוצר מופע חדש ReputationLedger268
- `getDefaultInstance513()` — singleton `defaultReputationLedger268`
- `ATTESTATION_TYPES_513`, `DECAY_HALF_LIFE_MS_513` — re-exported constants
- `registerEndpoints513(app)` — wire endpoint

## Endpoints חדשים
- `GET /api/v1/reputation/canon/status`
- `GET /api/v1/admin/summary/v513`

## מה חובר
V263–V267 (thin re-exports) + V268 (tip) → Canon513. קוד חדש מייבא רק `Canon513`.

## אימות
- `tests/v513.test.js` — 11/11 ✓
- `scripts/audit-tests.js` — 59/131 pass (+1), 72 cannotRun, 0 realFail
- SACRED intact, node --check clean

## מה לא אומת
- 72 cannotRun (vitest/ESM — לא ניתנים לבדיקה בסביבה זו)
- anti-collusion graph analysis ב-V268 לא נבדק end-to-end (רק API בדוק)
