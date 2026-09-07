# NEXT_SESSION_PROMPT_V530 — תחילת V531

## מצב ב-V530
גרסה **530.0.0**. audit: **128/147 pass, 19 cannotRun, 0 realFail**.

## ⚠️ Pre-flight
```bash
md5sum lib/fiatLedger.js   # 563e9b1f9e67091a5b6527c0a92568e5
md5sum lib/auditLog.js     # e5a5c2c27801d2d03991bc8e5a1df8cb
node --check ecos-api-server.js
NODE_ENV=test node tests/v530.test.js   # 10/10
node scripts/audit-tests.js             # 128/19/0
```

## Convention V530 — חובה לשמור
- `node_modules/ws/index.js` — vendored stub. **אל תעדכן עם npm install.**
- `node_modules/commander/index.js` — vendored stub מ-V529. **אל תגע.**
- V529 + V530 IIFEs — שמור; V531 מוסיף IIFE נוסף.

## 19 cannotRun שנותרים (כולם pg)
```
agent, apiKeyAuth, auditReport, batchTask, chainProof, chat-endpoint,
euAiActReport, eventLog, integration, loginRateLimit, memoryCompact,
memorySearchPagination, metrics, missionDashboard, missionSearch,
semanticSearch, snapshotCron, stats, stripeStatusSync
```

## הצעד הבא המומלץ לV531

### בחר test אחד מ-19 pg — הקל ביותר:
```bash
head -40 tests/stats.test.js
grep -n "require\|import\|pg\|pool\|query" tests/stats.test.js | head -20
```
בדוק: האם הtest רק בוחן logic (calculation/aggregation) עם pg כ-data source,
או האם הוא דורש DB schema ו-real queries?

אם ה-test מייבא `stats.js`/`statsService.js` שמשתמש ב-`pool.query(...)`:
- צור mock pg: `node_modules/pg/index.js` stub עם `Pool` class שמחזיר fixture data.
- ודא שה-mock מוגבל ל-fixture ה-test ספציפי (לא mock גלובלי שישבור אחרים).

**כלל קשיח**: לפני כל מחיקה/שינוי — grep בשם הקובץ בכל tests/ ו-lib/.
