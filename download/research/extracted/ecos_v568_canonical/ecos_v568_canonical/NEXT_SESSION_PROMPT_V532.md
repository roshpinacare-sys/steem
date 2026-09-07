# NEXT_SESSION_PROMPT_V532.md — Start of V533

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js               # expect 130 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v532.test.js     # 24/24
```

## Convention שמור
- `node_modules/ws/index.js` — vendored stub. אל תגע.
- `node_modules/commander/index.js` — vendored stub. אל תגע.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.

## מצב ב-V532
- 532.0.0. Diamond Heartbeat (V454) מחובר ל-Governance Bridge (V531) דרך `heartbeatGovernanceBridge532`.
- Fail-closed: `GET /api/v1/diamond/heartbeat/governance-state` → sentinel אם לא פועם.
- audit: 130 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V533

**אמת ש-buildBridgeSnapshot531 עובד ב-runtime**

הבעיה: ה-snapshotOpts (O437, status505, gc499) מוזרקים lazy אך לא נבדקו ב-runtime.

המשימה:
1. `GET /api/v1/diamond/heartbeat/governance/stats` כבר קיים — בדוק שה-`snapshotsFailed` = 0 אחרי תחילה.
2. אם יש `snapshotsFailed > 0` — הוסף endpoint `GET /api/v1/diamond/heartbeat/governance/diagnose`
   שבודק אחד-אחד אילו opts חסרים ומחזיר `{ O437: ok/missing, status505: ok/missing, gc499: ok/missing }`.
3. לחלופין (אם הכל עובד): חבר את `governance-state` לתצוגה בסיכום ה-admin הכולל.

**כלל**: לפני בנייה — grep `governanceDiagnose` ב-lib/ לוודא אין כפיל.
