# NEXT_SESSION_PROMPT_V539.md — Start of V540

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js               # expect 137 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v539.test.js     # 11/11
```

## Convention שמור (אל תשנה)
- `heartbeatGovernanceBridge532.activeBridge532` — getter/setter. V532 IIFE מאכלס.
- `heartbeatGovernanceBridge532.activeHb532` — getter/setter.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.

## מצב ב-V539
- 539.0.0. `deepHealthStatus539.js` — שילוב V538 aggregate + V533 governance diagnose.
- `GET /api/v1/deep-health/v539` מחזיר status + actionItems מפורטים.
- audit: 137 pass, 19 cannotRun, 0 realFail.

## הצעד הבא: V540

**אפשרות A — "action router"**
`GET /api/v1/deep-health/v539` מחזיר מה שבור. V540 יכול להוסיף:
`POST /api/v1/deep-health/restart-hb/v540` — מפעיל את ה-heartbeat אם הוא down (דרך Bridge532).
- שים לב: כל אוטונומיה חייבת דרך Orchestrator (V437) → Audit. לא ישירות.
- בדוק אם V437 זמין בשרת: `grep "require.*orchestrator" ecos-api-server.js | head -3`

**אפשרות B — structured alert export**
`GET /api/v1/deep-health/alerts/v540` — מחזיר actionItems כ-JSON מובנה יותר (severity, category, fix_url) כדי שמערכות monitoring יוכלו לצרוך.
- בטוחה יותר — read-only, zero side-effects.

**המלצה: B** — בטוחה יותר, read-only, שימושית לשילוב עם monitoring.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזידה מסתיים ב-540. IIFE בסוף. tests/v540.test.js exit 0.
- דווח: pass לפני→אחרי (מ-137), cannotRun, realFail.
