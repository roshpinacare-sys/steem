# NEXT_SESSION_PROMPT_V514.md — Start of V515

## Pre-flight
```bash
node scripts/audit-tests.js    # expect pass=60, cannotRun=72, realFail=0
node --check ecos-api-server.js
NODE_ENV=test node tests/v514.test.js   # 13/13
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V514
- 514.0.0. `offlineQueueCanon514.js` — facade ל-6 מודולי offlineQueue (V263–V268).
- GET /api/v1/offline-queue/canon/status + queue-status/v514 + summary/v514.
- audit: 60 pass, 72 cannotRun, 0 realFail.

## הצעד הבא — V515
הרץ: `ls lib/ | grep -v Canon | sed 's/[0-9]*\.js$//' | sort | uniq -c | sort -rn | head -10`

מגדלים עם מספר מודולים ללא Canon (ידועים):
- `quadraticFunding` — בדוק כמה מודולים וסוג (parallel או chain?)
- `splitModule` — בדוק
- כל מגדל עם 4+ ובלי Canon שטרם טופל

**המלצה: בדוק quadraticFunding — אם parallel-dup (לא chain), בנה `quadraticFundingCanon515.js`**

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-515. IIFE בסוף השרת.
- דווח: X/Y pass, Z cannotRun, W realFail מ-audit-tests.js.
- בתיעוד: חובה סעיף "מה לא אומת".
