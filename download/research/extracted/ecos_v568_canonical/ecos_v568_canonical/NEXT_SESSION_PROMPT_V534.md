# NEXT_SESSION_PROMPT_V534.md — Start of V535

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js               # expect 132 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v534.test.js     # 13/13
```

## Convention שמור
- `node_modules/ws/index.js` + `node_modules/commander/index.js` — vendored stubs. אל תגע.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.
- IIFE של V532 מחזיק `_bridge532` singleton — אל תשנה אותו.

## מצב ב-V534
- 534.0.0. `governanceHealthGate534` — unified health: stats + diagnose + state.
- `GET /api/v1/diamond/heartbeat/governance/health` → `{ ok, level, snapshot, diagnose?, reason }`.
- `hbRunning` מחזיר false (heartbeat singleton לא נגיש מ-IIFE חיצוני) — ידוע.
- 132 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V535

**חשוף את `_bridge532` ל-V534 דרך singleton accessor**

כרגע `_bridge532` חי בתוך IIFE של V532 ולא נגיש. עצב accessor:
```js
// בסוף IIFE של V532, לפני }()):
global.__ecosBridge532 = _bridge532;   // OR: require('./lib/heartbeatGovernanceBridge532').defaultBridge532 = _bridge532
```
אם הגרסה של `heartbeatGovernanceBridge532.js` לא חושפת singleton — הוסף:
```js
module.exports.activeBridge532 = null;  // setter set by IIFE
```
ואז V534 יוכל לקרוא `require('./lib/heartbeatGovernanceBridge532').activeBridge532` ולקבל instance אמיתי.

**grep לפני**: `grep "activeBridge532\|__ecosBridge532" lib/ ecos-api-server.js` — אם לא קיים, בטוח לבנות.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-535. tests/v535.test.js exit 0 → zip.
