# NEXT_SESSION_PROMPT_V542.md — Start of V543

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js        # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js                     # expect 140 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v542.test.js           # 18/18
```

## Convention שמור (אל תשנה)
- `heartbeatGovernanceBridge532.activeBridge532` / `.activeHb532` — getter/setter, V532 IIFE מאכלס.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.
- `_classifyItem540`: סדר קריטי — hbRunning קודם, activeHb שני, bridge שלישי.

## מצב ב-V542
- 542.0.0. `deepHealthAlertHistory542.js` — ring buffer N=50 של snapshots מ-`deepHealthAlertFilter541`.
- `GET /api/v1/deep-health/alert-history/v542` — history עם limit/since/onlyDegraded
- `GET /api/v1/deep-health/alert-history/trend/v542` — trend: rising/falling/stable/unknown
- audit: **140 pass, 19 cannotRun, 0 realFail**.

## Deep-Health Stack (קו אחיד, לא לשבור):
```
deepHealthAlerts540          ← buildAlerts540() — raw alerts
  └─ deepHealthAlertFilter541  ← buildFilteredAlerts541(query) — filtered
       └─ deepHealthAlertHistory542  ← push542() / getHistory542() / getTrend542()
```

## הצעד הבא — V543

**אפשרות A — Alert Trigger: auto-capture לhistory**
`deepHealthHistoryScheduler543.js` — מאזין ל-heartbeat/orchestrator ומפעיל `push542()`
ב-interval קבוע (למשל כל 60 שניות). כך ה-history מתמלא אוטומטית, לא רק ב-HTTP request.
⚠️ דורש גישה לheartbeat — בדוק ש-`heartbeatGovernanceBridge532` זמין.

**אפשרות B — Tower Canon: marketMaker**
`lib/marketMakerCanon543.js` — marketMaker333 הוא ה-tip של inheritance chain (298→...→333).
facade שחושף את API של 333 בלבד. ⚠️ inheritance chain — אל תנסה thin re-export.

**אפשרות C — History Aggregator: יומי/שעתי**
aggregator שמקבץ snapshots ל-buckets (per-minute, per-hour) עם avg/max/min.
מחבר את ה-V542 ring buffer לsummaries ניתנות לגרף.

**המלצה: B** — marketMakerCanon543 יאחד 36 מודולים לנקודת כניסה אחת.
  גדול ביותר מבין ה-towers שנותרו, ועצמאי (לא תלוי ב-heartbeat).
  ⚠️ לפני: `grep "require.*marketMaker" ecos-api-server.js | head -10` לוודא שרשרת inheritance.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-543. IIFE בסוף. tests/v543.test.js exit 0.
- דווח: X/Y pass לפני→אחרי (מ-140), cannotRun, realFail.
- חובה: "מה לא אומת".
