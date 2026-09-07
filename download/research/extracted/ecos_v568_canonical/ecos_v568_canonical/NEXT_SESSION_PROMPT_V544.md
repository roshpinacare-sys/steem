# NEXT_SESSION_PROMPT_V544.md — Start of V545

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
NODE_ENV=test node tests/v544.test.js      # expect 34/0
node scripts/audit-tests.js               # expect 142 pass / 19 cannotRun / 0 realFail
```

## מצב ב-V544
- 544.0.0. `deepHealthHistoryScheduler544.js` — scheduler שמאזין ל-DiamondHeartbeat465
  ומפעיל `push542()` אוטומטית. attach() ב-startup, circuit-breaker, status endpoint.
- בסיס: V543a — marketMakerCanon543, cryptoRail, תיקוני v510/v528/v534.
- **audit: 142 pass, 19 cannotRun, 0 realFail**

## Stack נוכחי (deep health):
```
DiamondHeartbeat465
  └─ heartbeatGovernanceBridge532 (_onBeat532)
       └─ deepHealthStatus539
            └─ deepHealthAlerts540
                 └─ deepHealthAlertFilter541
                      └─ deepHealthAlertHistory542 (ring buffer N=50)
                           └─ deepHealthHistoryScheduler544 ← NEW (auto-push)
```

## ⚠️ Convention שמור
- `heartbeatGovernanceBridge532.activeBridge532/activeHb532` — getter/setter, V532 IIFE מאכלס.
- `tests/v528.test.js` שורה 65 — non-self filter כולל v510/v528/v534. אל תצמצם.
- `_classifyItem540`: סדר קריטי — hbRunning קודם, activeHb שני, bridge שלישי.
- `marketMakerCanon543` הוא ה-tip. `deepHealthHistoryScheduler544` מפעיל `push542`.

## הצעד הבא — V545 (בחר אחד)

**אפשרות A — אגרגטור שעתי מ-V543b** (פשוט, יכולת מוכחת):
`deepHealthAlertAggregator545.js` — מקפל history542 לbuckets שעתיים (כפי שV543b עשה אך על בסיס בריא).
Stack: `scheduler544.push542() → history542 → aggregator545`
יתרון: עצמאי לחלוטין, לא תלוי ב-heartbeat חי.

**אפשרות B — Policy Engine**:
`deepHealthPolicy545.js` — מחליט (auto/manual) לפי composite score מ-Canon543 + trend מ-history542.

**אפשרות C — double-wrap safety** (טכני, בטיחות):
בדוק אם `_beat465` כבר wrapped לפני patch — אם כן, chain בצורה בטוחה.

**המלצה: A** — מהיר, עצמאי, משלים stack שהתחיל ב-V539.

## 19 cannotRun (לא לשנות — בעיית סביבה, לא קוד)
express+supertest+pg לא מותקנות. cannotRun אמיתי, לא realFail.
