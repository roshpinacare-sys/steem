# CHANGELOG_V536.md — governanceHealthGate534 × activeBridge532 Connection

## מה זוהה
V534 IIFE ניסה לגשת לסינגלטון ה-bridge דרך:
```js
require('./lib/heartbeatGovernanceBridge532.js').defaultBridge532 ? require(...).defaultBridge532() : null
```
`defaultBridge532` לא קיים במודול → תמיד `null` → `buildHealthReport534` קיבל bridge=null.
אחרי V535 שחשף `activeBridge532`, הפתרון הפך לאפשרי.

## מה תוקן ומה חובר

**תיקון ב-`ecos-api-server.js` V534 IIFE:**
```js
// לפני (שבור):
var _b532_534 = require('...').defaultBridge532 ? require('...').defaultBridge532() : null;
// אחרי (עובד):
var _b532_534 = require('./lib/heartbeatGovernanceBridge532.js').activeBridge532 || null;
```

**V536 IIFE חדש:**
- `GET /api/v1/diamond/heartbeat/governance/health-v536` — health report עם `bridgeLive` field שמוכיח שהחיבור עובד.
- `GET /api/v1/admin/summary/v536`

**שרשרת חיבור שלמה:**
```
V532 IIFE → createBridge532() → sets activeBridge532 (V535)
V534 IIFE → reads activeBridge532 → buildHealthReport534 (מקבל bridge אמיתי)
V536 IIFE → health-v536 endpoint עם bridgeLive:true/false
```

## תוצאות אימות (לפני → אחרי)
| | לפני | אחרי |
|-|------|------|
| pass | 133 | **134** |
| cannotRun | 19 | 19 |
| realFail | 0 | **0** |

## מה לא אומת
- 19 cannotRun (vitest/ESM).
- `bridgeLive` יחזיר `false` עד שמפעילים `POST /governance/start` — מכוון, fail-closed.
- `hbRunning` עדיין `false` — heartbeat singleton עדיין בתוך V532 IIFE. זה הסיכון הפתוח הבא.
