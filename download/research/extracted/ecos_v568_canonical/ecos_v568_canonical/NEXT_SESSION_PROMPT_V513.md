# NEXT_SESSION_PROMPT_V513.md — Start of V514

## Pre-flight
```bash
node scripts/audit-tests.js    # expect pass=59, cannotRun=72, realFail=0
node --check ecos-api-server.js
NODE_ENV=test node tests/v513.test.js   # 11/11
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V513
- 513.0.0. `reputationLedgerCanon513.js` — facade ל-6 מודולי reputationLedger (V263–V268).
- `GET /api/v1/reputation/canon/status` + `GET /api/v1/admin/summary/v513`.
- audit: 59 pass, 72 cannotRun, 0 realFail.

## הצעד הבא — V514
מגדלים פתוחים (ללא Canon):
```bash
ls lib/ | grep -v Canon | sed 's/[0-9].*$//' | sort | uniq -c | sort -rn | head -10
```

מגדלים עם 6 מודולים ללא Canon (ידועים): offlineQueue, onboardingFlow, quadraticFunding, reflectionLoop (כבר יש Canon507), telemetry (Canon511), splitModule.

**המלצה: `offlineQueueCanon514.js`** (6 מודולים V263–V268, parallel pattern)
- `GET /api/v1/offline-queue/canon/status`
- חשיפת OfflineQueue268 instance creation + priority levels
- 10+ tests, exit 0

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזידה מסתיים ב-514. IIFE בסוף השרת.
- דווח: X/Y pass, Z cannotRun, W realFail מ-audit-tests.js.
