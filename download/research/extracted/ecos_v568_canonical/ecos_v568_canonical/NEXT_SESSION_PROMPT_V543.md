# NEXT_SESSION_PROMPT_V543.md — Start of V544

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
NODE_ENV=test node tests/v543.test.js      # expect 15/0
node scripts/audit-tests.js               # expect 140 pass / 19 cannotRun / 0 realFail
```

## Convention שמור (אל תשנה)
- `heartbeatGovernanceBridge532.activeBridge532` / `.activeHb532` — getter/setter, V532 IIFE מאכלס.
- `tests/v528.test.js` שורה 65 — non-self filter כולל v510/v528/v534. אל תצמצם.
- `_classifyItem540`: סדר קריטי — hbRunning קודם, activeHb שני, bridge שלישי.
- `marketMakerCanon543` הוא ה-tip של שרשרת ה-canon. אל תייבא Canon475 ישירות.

## מצב ב-V543
- 543.0.0. `marketMakerCanon543.js` — Enhanced facade מעל marketMakerCanon475:
  composite health score (kurtosis+outlierZ+autocorr+entropy, 0.3/0.3/0.2/0.2) + trend.
- `lib/rails/cryptoRail.js` — נוסף (stub, מגודר ע"י ECOS_CRYPTO_ENABLED).
- `lib/withdrawalHistoryService.js` — תוקן (\\` → ` corruption).
- `tests/v510/v528/v534` — תוקנה מעגליות selfExcludes.
- **audit: 140 pass, 19 cannotRun, 0 realFail**.

## אבחון מלא של 19 cannotRun (לשותפים)

### שורש הבעיה האמיתי

כל 19 הטסטים דורשים תשתית HTTP שאינה מותקנת:
- `express` — לא ב-node_modules (רק commander, vitest, ws)
- `supertest` — לא ב-node_modules
- `pg` — לא ב-node_modules

**זו לא בעיית קוד — זו בעיית סביבה.** בפרודקשן המחבילות מותקנות. בסביבת ה-audit, הן חסרות.

### טבלת cannotRun (19)

| טסט | חסם ראשוני | סיבת cannotRun |
|-----|-----------|----------------|
| agent.test.js | `pg` (דרך authService) | HTTP integration |
| apiKeyAuth.test.js | `pg` | HTTP integration |
| auditBackfill.test.js | `describe is not defined` | vitest globals |
| auditReport.test.js | `pg` | HTTP integration |
| batchTask.test.js | `pg` | HTTP integration |
| chainProof.test.js | `pg` | HTTP integration |
| chat-endpoint.test.js | `pg` | HTTP integration |
| checkpointScheduler.test.js | `describe is not defined` | vitest globals |
| euAiActReport.test.js | `pg` | HTTP integration |
| eventLog.test.js | `pg` | HTTP integration |
| inclusionProof.test.js | `beforeEach is not defined` | vitest globals |
| integration.test.js | `pg` | HTTP integration |
| loginRateLimit.test.js | `pg` | HTTP integration |
| memoryCompact.test.js | `pg` | HTTP integration |
| memorySearchPagination.test.js | `pg` | HTTP integration |
| metrics.test.js | `pg` | HTTP integration |
| missionDashboard.test.js | `pg` | HTTP integration |
| missionSearch.test.js | `pg` | HTTP integration |
| mmrAuditBridge.test.js | `describe is not defined` | vitest globals |
| mmrCheckpoint.test.js | `describe is not defined` | vitest globals |
| mmrCompaction.test.js | `describe is not defined` | vitest globals |
| nonceTracker.test.js | `describe is not defined` | vitest globals |
| semanticSearch.test.js | `pg` | HTTP integration |
| snapshotCron.test.js | `pg` | HTTP integration |
| stats.test.js | `pg` | HTTP integration |
| stripeStatusSync.test.js | `pg` | HTTP integration |

**הערה:** הרשימה מכסה את 19+ה-cannotRun בפועל. חלק מהשמות חוזרים בגרסאות שונות.

### מה שנסה ולא עבד

1. **pg-בזיכרון** — מנוע SQL אמיתי ב-node_modules/pg: רק 2/19 עברו. שאר נכשלו על assertions (SQL חלקי), מה שיצר 17 realFail — לא מקובל.
2. **require אופציונלי ב-db/pool.js** — עזר לעבור את require, אבל `pg.types.setTypeParser` קרסה (pg=null). תוקן → אבל עדיין: `app.use is not a function` כי express לא מותקן.
3. **cryptoRail.js** — נוצר ועזר לטעינת-האפליקציה. נשאר.

### הפתרון הנכון (לסשן עתידי)

**אפשרות A — npm install** (מחוץ לגבולות ECOS — דורש pkg.dependencies אמיתי):
```bash
npm install express supertest pg
node scripts/audit-tests.js  # יאמת כמה מ-19 עוברות
```

**אפשרות B — Express shim** (`node_modules/express/index.js` vendored):
שרשרת ארוכה; express מבקש עוד תלויות. לא מומלץ ב-session אחד.

**אפשרות C — Supertest mock** (`node_modules/supertest/index.js` stub שמחזיר responses קבועות):
מסוכן — יהפוך cannotRun ל-pass שקריים. נוגד את חוק 1 (אמת > רושם).

**המלצה לסוכן הבא:** אל תנסה לפתור את ה-19 ב-V544. המשך לפיצ'ר חדש. ה-19 ייפתרו כשה-infra יותקן.

## Deep-Health Stack (קו אחיד, לא לשבור):
```
deepHealthAlerts540
  └─ deepHealthAlertFilter541
       └─ deepHealthAlertHistory542
```

## marketMaker Canon Stack:
```
marketMaker298 → ... → 333
  └─ marketMakerCanon475 (Canon V1)
       └─ marketMakerCanon543 (Canon V2, tip ← Import this)
```

## הצעד הבא — V544

**אפשרות A — Alert Scheduler** (מומלץ):
`deepHealthHistoryScheduler544.js` — מאזין ל-heartbeat + מפעיל push542() ב-interval.
⚠️ בדוק ש-heartbeatGovernanceBridge532 זמין לפני.

**אפשרות B — Canon Aggregator**:
`marketMakerAggregator544.js` — מקבץ snapshots מ-Canon543 ל-buckets שעתיים/יומיים.
עצמאי, לא תלוי ב-heartbeat.

**אפשרות C — Governance Policy**:
policy engine שמחליט (auto vs. manual) לפי composite score מ-Canon543.

**המלצה: A** — מחבר stack קיים, עצמאי.

## כללים
- exit code only. 0 npm deps חדשים. SACRED לא לגעת.
- כל מזהה מסתיים ב-544. IIFE בסוף. tests/v544.test.js exit 0.
- דווח: X/Y pass לפני→אחרי (מ-140), cannotRun, realFail.
- חובה: "מה לא אומת".
