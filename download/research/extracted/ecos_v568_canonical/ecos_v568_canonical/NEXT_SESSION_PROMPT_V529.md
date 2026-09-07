# NEXT_SESSION_PROMPT_V529 — תחילת V530

## מצב ב-V529
גרסה **529.0.0**. audit: **126 pass / 20 cannotRun / 0 realFail**.

שני שיפורים ב-V529:
1. **commander stub** vendored → cli.test.js: cannotRun → pass (23/23)
2. **monitor fast-close** → monitor.test.js: realFail → pass (5/5, 302ms)

## ⚠️ Pre-flight (חובה לפני כל שינוי)
```bash
# SACRED (אסור לגעת):
md5sum lib/fiatLedger.js  # 563e9b1f9e67091a5b6527c0a92568e5
md5sum lib/auditLog.js    # e5a5c2c27801d2d03991bc8e5a1df8cb

# Syntax:
node --check ecos-api-server.js
node --check monitor/index.js

# V529 suite:
NODE_ENV=test node tests/v529.test.js    # → 16/16 passed

# Key tests directly (fast verification):
node --require node_modules/vitest/globals.cjs tests/cli.test.js     # → 23/23
node --require node_modules/vitest/globals.cjs tests/monitor.test.js # → 5/5

# Full audit (takes ~3 min, sequential, שים לב):
node scripts/audit-tests.js   # → 126/20/0
```

## ⛔ 20 ה-cannotRun שנותרים
```
19× pg (postgres): agent, apiKeyAuth, auditReport, batchTask, chainProof,
    chat-endpoint, euAiActReport, eventLog, integration, loginRateLimit,
    memoryCompact, memorySearchPagination, metrics, missionDashboard,
    missionSearch, semanticSearch, snapshotCron, stats, stripeStatusSync

1× ws (WebSocket): ws.test.js
```

## הצעד הבא המומלץ לV530

### Option A: ws stub (קל-בינוני)
```bash
head -50 tests/ws.test.js
```
בדוק: האם ws.test.js בוחן רק EventEmitter API, או דורש WebSocket protocol אמיתי?
אם EventEmitter-based → בנה `node_modules/ws/index.js` stub (EventEmitter + Server class).
סיכון: ws.test.js מייבא `ValidatorHub` שמשתמש ב-WebSocket — ייתכן שצריך partial broadcast mock.

### Option B: בחר test אחד מ-19 pg ובדוק את ה-mocking path
```bash
head -30 tests/agent.test.js
grep -n "require\|import" tests/agent.test.js | head -20
```
pg stub מלא הוא קשה (יש pg pool/query protocol). אבל אם test מסוים רק בודק logic
שאפשר לנתק מ-pg, אולי אפשר לתקן ב-fixture/stub קטן.

## Convention V529 — חובה לשמור
- `node_modules/commander/index.js` — vendored stub. **אל תעדכן עם npm install.**
- `monitor/index.js` — `statusServer.close()` מ-patched. `closeAllConnections()` נקרא לפני `_origClose()`.
- V529 IIFE ב-`ecos-api-server.js` — שמור; V530 מוסיף IIFE נוסף (אל תמחק V529).
- כל tests חדשות ב-`tests/v529.test.js` — שמור כ-reference; V530 יוסיף `tests/v530.test.js`.

## אריזה
`ecos_v530_canonical.zip`, שורש `ecos_v530_canonical/`, ממנו עובד:
`cp -r ecos_v529_canonical ecos_v530_canonical && cd ecos_v530_canonical && # ... שינויים ...`
