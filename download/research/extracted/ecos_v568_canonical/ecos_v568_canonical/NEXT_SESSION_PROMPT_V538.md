# NEXT_SESSION_PROMPT_V538.md — Start of V539

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js               # expect 136 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v538.test.js     # 10/10
```

## Convention שמור (אל תשנה)
- `heartbeatGovernanceBridge532.activeBridge532` — getter/setter. V532 IIFE מאכלס.
- `heartbeatGovernanceBridge532.activeHb532` — getter/setter. `_getOrCreate532` מאכלס.
- `defaultBridge532` לא קיים — לא להשתמש.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.

## מצב ב-V538
- 538.0.0. `aggregatedHeartbeatStatus538.js` — מאגד V532→V534→V536→V537.
  תיקון: `hbRunning` קורא `activeHb532` ישירות (V534 תמיד החזיר false).
- pass=136, cannotRun=19, realFail=0.

## הצעד הבא: V539

**אפשרות A — "deep health" endpoint**
שלב את `/aggregate/v538` עם `governanceDiagnose533` לייצר `/deep-health/v539`:
כשה-heartbeat או הbridge down — מחזיר diagnostic מפורט (למה, מה שבור, מה לתקן).

**אפשרות B — expose hbRunning ב-V534 endpoint עצמו (patch)**
```js
// בתוך V534 IIFE (שינוי קיים — בדוק שהטסט v534 עובר אחרי):
var _hb532_534 = null;
try { _hb532_534 = require('./lib/heartbeatGovernanceBridge532.js').activeHb532 || null; } catch (_) {}
```
אם V534 endpoint לא מכוסה בטסט strict — בטוח לשנות.
אם מכוסה — אל תשבור, לך על אפשרות A.

**המלצה: A** — בטוחה יותר, תוספת ולא שינוי.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-539. IIFE בסוף. tests/v539.test.js exit 0.
- דווח: pass לפני→אחרי, cannotRun, realFail.
