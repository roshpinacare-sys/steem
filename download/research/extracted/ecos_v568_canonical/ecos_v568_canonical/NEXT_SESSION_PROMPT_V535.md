# NEXT_SESSION_PROMPT_V535.md — Start of V536

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js               # expect 133 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v535.test.js     # 12/12
```

## Convention שמור
- `heartbeatGovernanceBridge532.activeBridge532` — getter/setter. V532 IIFE מאכלס. אל תשנה ל-plain property.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.
- IIFE של V532 מחזיק `_bridge532` singleton — `Bridge532.activeBridge532 = _bridge532` כבר שם.

## מצב ב-V535
- 535.0.0. Bridge532 singleton נחשף: `require('./lib/heartbeatGovernanceBridge532').activeBridge532`.
- `GET /api/v1/diamond/heartbeat/governance/bridge-live` — live stats מה-singleton.
- 133 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V536

**חבר `governanceHealthGate534` לסינגלטון**

כרגע `governanceHealthGate534` לא משתמש ב-`activeBridge532` כדי לדעת אם ה-heartbeat פועל.

```bash
grep -n "hbRunning\|activeBridge532" ecos-api-server.js | grep "534\|535" | head -10
```

אם V534 עדיין מחזיר `hbRunning: false` — שדרג את endpoint V534 לקרוא:
```js
const Bridge532 = require('./lib/heartbeatGovernanceBridge532.js');
const hbRunning536 = !!Bridge532.activeBridge532;
```
ו-V536 יכול להוסיף שדה `bridgeLive` ל-health response של V534.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-536. tests/v536.test.js exit 0 → zip.
