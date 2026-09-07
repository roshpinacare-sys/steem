# CHANGELOG_V514.md — V514

## מה זוהה
- Baseline: 59 pass, 72 cannotRun, 0 realFail.
- `NEXT_SESSION_PROMPT_V513` הצביע על מגדל `offlineQueue` (V263–V268, 6 מודולים) ללא Canon.
- V263–V267 הם thin re-exports ל-V268 (לא inheritance-chain שבירה).
- V268 (tip) חושף: OfflineQueue268, defaultOfflineQueue268, PRIORITY_LEVELS_268, MAX_QUEUE_SIZE_268.

## מה נבנה
**`lib/offlineQueueCanon514.js`** — facade קנוני:
- `getCanonInfo514()` — metadata + capabilities list
- `getHealthSummary514()` — health snapshot: towerLoaded, instanceReady, stats, activeUserQueues, priorityLevels
- `createInstance514(opts)` — new OfflineQueue268, fail-closed אם לא נטען
- `getDefaultInstance514()` — singleton shared
- `getQueueStatus514(userId)` — queue depth + byPriority breakdown, fail-closed ל-userId לא-תקין
- `registerEndpoints514(app)` — wires 3 endpoints

## Endpoints חדשים
- `GET /api/v1/offline-queue/canon/status` (V514-T01)
- `GET /api/v1/offline-queue/queue-status/v514?userId=` (V514-T02)
- `GET /api/v1/admin/summary/v514` (V514-T03)

## תוצאות אימות
- `tests/v514.test.js` → **13/13 pass** (exit 0)
- `scripts/audit-tests.js` → **60 pass, 72 cannotRun, 0 realFail** (+1 pass ביחס ל-V513)
- `node --check ecos-api-server.js` ✓
- SACRED: `563e9b1f...` / `e5a5c2c2...` ✓

## מה לא אומת
- 72 suites בסטטוס cannotRun (vitest/ESM) — לא ניתן לאמת בסביבה זו, לא נספרו כעובר ולא ככשל.
- endpoint `/api/v1/offline-queue/queue-status/v514` לא נבדק עם שרת חי (רק unit tests).
