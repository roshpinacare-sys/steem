# NEXT_SESSION_PROMPT_V540.md — Start of V541

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js      # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js                   # expect 138 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v540.test.js         # 14/14
```

## Convention שמור (אל תשנה)
- `heartbeatGovernanceBridge532.activeBridge532` — getter/setter. V532 IIFE מאכלס.
- `heartbeatGovernanceBridge532.activeHb532` — getter/setter.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.
- `_classifyItem540`: סדר הבדיקות קריטי — hbRunning קודם, אחר-כך activeHb, אחר-כך bridge. אל תהפוך.

## מצב ב-V540
- 540.0.0. `deepHealthAlerts540.js` — structured alert export מ-V539.
- `GET /api/v1/deep-health/alerts/v540` → alerts[] עם severity/category/fix_url.
- audit: 138 pass, 19 cannotRun, 0 realFail.

## הצעד הבא — V541

**אפשרות A — Alert Severity Filter**
`GET /api/v1/deep-health/alerts/v540?severity=critical` כבר קיים בשרת.
V541 יוסיף query-param filtering מובנה ל-V540: `?severity=critical|warning|info&category=bridge|heartbeat|...`
- בטוחה לחלוטין — read-only, רק מסנן את הפלט הקיים.

**אפשרות B — Alert History Ring Buffer**
V541: `lib/deepHealthAlertHistory541.js` — ring buffer של snapshots אחרונים (N=50).
כל קריאה ל-`/api/v1/deep-health/alerts/v540` תירשם. endpoint חדש: `GET /api/v1/deep-health/alert-history/v541`.
- מאפשר לראות trended alerts לאורך זמן.

**המלצה: A** — פשוטה יותר, read-only, בנויה על מה שקיים, 0 state חדש.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-541. IIFE בסוף. tests/v541.test.js exit 0.
- דווח: X/Y pass לפני→אחרי (מ-138), cannotRun, realFail.
