# NEXT_SESSION_PROMPT_V503.md — Start of V504

## State at V503
- 503.0.0. realFail: **0** (היה 1). Pass: **49/121**. cannotRun: **72** (unverified, need vitest).
- `testStatusReport503.js` — מחשף מפת אמת דרך GET /api/v1/admin/test-status/v503.
- `tests/README.md` — תיעוד מפורש לcannotRun.
- SACRED intact; node --check clean; 24/24 green.

## Pre-flight (חובה)
```bash
node scripts/audit-tests.js            # truth: pass / cannotRun / realFail
node --check ecos-api-server.js
NODE_ENV=test node tests/v503.test.js
md5sum lib/fiatLedger.js lib/auditLog.js  # 563e9b1f... / e5a5c2c2...
```

## High-leverage next (pick ONE)

### אפשרות 1 — meshDispatcher tower retirement (הנדסית, בעל מינוף)
```bash
ls lib/meshDispatcher*.js | sort -V
# Canon: meshDispatcherCanon478 (exists)
# שיטה בטוחה: לא thin re-export (inheritance chain!) — במקום זה:
# 1. בדוק שהשרת מייבא רק את Canon478 (לא 288-297)
# 2. אם כן — העבר 288-297 ל-_archive_orphans/ (בדוק 0 refs בשרת+טסטים)
# 3. עדכן hexaTowerCanon481 ו-testStatusReport503 בהתאם
```

### אפשרות 2 — audit-tests יריץ גם v243 (regression test)
הוסף לscripts/audit-tests.js שורה שמריצה v243 ומאמת exit 0 — כדי שrealFail לא יחזור.

### אפשרות 3 — Diamond posture למשתמשים
חשיפת health summary של Diamond (V462+V465 heartbeat) ב-GET /api/v1/status — מידע ברור למשתמשים.

## כלל הזהב
> **"X/Y עברו, Z cannotRun, W realFail"** — לעולם לא "הכל עובד".
