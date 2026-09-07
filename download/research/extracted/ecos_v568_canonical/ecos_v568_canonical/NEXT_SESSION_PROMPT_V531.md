# NEXT_SESSION_PROMPT_V531 — תחילת V532

## מצב ב-V531
**531.0.0** | audit: **129/148 pass, 19 cannotRun, 0 realFail**.

## Pre-flight חובה
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js               # expect 129 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v531.test.js     # 24/24
```

## Convention — שמור
- `node_modules/ws/index.js` — vendored stub. אל תגע.
- `node_modules/commander/index.js` — vendored stub. אל תגע.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.

## הצעד הבא הכי בעל-מינוף: V532

**חיבור Heartbeat → Governance Bridge (לסגירת הלולאה)**

ב-V465 קיים Diamond Heartbeat (`POST /api/v1/diamond/heartbeat/start`).
כל פעימה מריצה cognition→decide. אבל היא **לא** קוראת ל-`governanceStatusBridge531`.

**המשימה**:
1. בנה `heartbeatGovernanceBridge532.js` — wrapper שכשהלב פועם, גם קורא
   ל-`buildBridgeSnapshot531` ושומר את הסנאפשוט האחרון בזיכרון (last-known-state).
2. Endpoint: `GET /api/v1/diamond/heartbeat/governance-state` — מחזיר הסנאפשוט
   האחרון שנרשם בפעימה האחרונה.
3. ודא שה-heartbeat loop לא נפיל את השרת אם governance-cycle איטי.

**כלל**: fail-closed (אם הלב לא פועם — endpoint מחזיר `{ ok: false, reason: 'not_started' }`).
**לפני בנייה**: grep `heartbeatGovernanceBridge` ב-lib/ ובשרת כדי לוודא שאין כפיל.

## 19 cannotRun שנותרים (כולם vitest/ESM)
agent, apiKeyAuth, auditReport, batchTask, chainProof, chat-endpoint,
euAiActReport, eventLog, integration, loginRateLimit, memoryCompact,
memorySearchPagination, metrics, missionDashboard, missionSearch,
semanticSearch, snapshotCron, stats, stripeStatusSync
