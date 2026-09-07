# CHANGELOG_V520.md

## V520 — Audit Wrap + Classification Table (Phase P408)

### מה זוהה (Action D, המשך ל-V519)
V519 חשף ב-probe קריא-בלבד 14 endpoints non-GET ללא `auditLog` נראה לעין
ו-12 ללא `guard402` נראה לעין. ה-probe לא הכריע — V520 הוא הצעד הראשון
לסגירת הפער: טבלת סיווג ידנית + עוטף `failClosed` שלא נותן להריץ handler
שמזיז כסף אם לא נכתבה רשומת audit.

### מה נבנה
**`lib/auditWrap520.js`** + מראה בייט-בייט ב-`src/lib/` (md5 = `45eb226354b367c47d07eacfc3321be8`).

- `CLASSIFICATIONS_520` — Object.freeze, מסווג endpoints מה-probe ל-
  `false-positive` (audit פנימי בתוך service), `exempt` (preview/quote/simulate),
  `real-gap` (חייב wrapper), או — דיפולט — `unclassified` (fail-closed).
- `classifyEndpoint520({method,path})` — מחזיר את הסיווג. כל endpoint לא ידוע
  נשאר `unclassified` — לא מנוקה אוטומטית.
- `wrapHandlerWithAudit520(handler, meta, opts)` — עטיפה דקה ל-Express handler.
  לפני כל קריאה ל-handler, מבצע `auditLog.append(meta.kind, {source, wrap, ts,
  meta, payload})`. ה-payload עובר sanitization (BigInt → string, חיתוך ב-2KB).
  אם `opts.failClosed === true` ו-`auditLog.append` זרק → 503 + `error:
  'audit_unavailable'`, וה-handler **לא רץ**. אחרת — שגיאת audit נבלעת
  (`console.warn`) וה-handler ממשיך.
- `getRealGapList520()` — קורא ל-`scanServer519` ומפצל את הרשימה ל-`realGaps`
  ו-`unclassified` (לפי הטבלה).
- `getWrapSummary520()` — תקציר ספירות.
- `_DEMO_AUDIT_520` (instance `AuditLog` מבודד) + `getDemoAuditChain520()` —
  שרשרת חיה להוכחת התנהגות העוטף.
- `registerEndpoints520(app)` — 6 endpoints.

**Endpoints חדשים:**
- `GET  /api/v1/registry/audit-wrap-v520/status`             — V520-T01
- `GET  /api/v1/registry/audit-wrap-v520/classifications`    — V520-T02
- `GET  /api/v1/registry/audit-wrap-v520/real-gaps`          — V520-T03
- `POST /api/v1/audit-wrap-v520/demo`                        — V520-T04 (wrapped, failClosed=true, כותב ל-_DEMO_AUDIT_520)
- `GET  /api/v1/registry/audit-wrap-v520/demo-chain`         — V520-T05
- `GET  /api/v1/admin/summary/v520`                          — V520-T06

IIFE `_wireAuditWrap520` בסוף `ecos-api-server.js` (try/catch, לא-פטאלי).

### אילוצים
- 0 npm deps חדשים. Node built-ins + `./auditLog.js` + `./auditCompletenessProbe519.js` בלבד.
- SACRED לא נגעו (`lib/fiatLedger.js` / `lib/auditLog.js` — md5 נשמר, נבדק בטסט).
- אפס שינוי endpoints קיימים. אפס מחיקות. אפס שינוי לוגיקה במודולים קיימים.
- אפס דריסה: ה-IIFE רק מוסיף endpoints חדשים. לא מנסה להחליף ראוטים קיימים.
- כל מזהה מסתיים ב-`520`. שיקוף ב-`src/lib/` בהעתק בייט-בייט (md5 זהה).
- fail-closed: כל endpoint שה-probe מסמן ושלא רשום בטבלה — `unclassified`,
  לא מנוקה אוטומטית, נשאר בתור.

### תוצאות אימות (exit code בלבד)
| בדיקה | תוצאה |
|---|---|
| `node --check ecos-api-server.js` | ✅ PARSE_OK |
| `node --check lib/auditWrap520.js` | ✅ PARSE_OK |
| SACRED md5 (fiatLedger, auditLog) | ✅ ללא דריפט |
| md5 lib/auditWrap520.js == src/lib/auditWrap520.js | ✅ זהה |
| `NODE_ENV=test node tests/v520.test.js` | ✅ **22/22, exit 0** |
| `NODE_ENV=test node tests/v519.test.js` (רגרסיה) | ✅ נכלל באודיט |
| `node scripts/audit-tests.js` | ✅ **66 pass / 72 cannotRun / 0 realFail** (בסיס V519: 65/72/0, +1 הסוויטה החדשה) |

### שינויים בקבצים קיימים
- `package.json` → `"version": "520.0.0"` (נכתב ב-Python עם `ensure_ascii=False`).
- `ecos-api-server.js` → תוספת IIFE `_wireAuditWrap520` בסוף (לא ערך קוד קיים).
- אפס שינוי בטסטים ישנים. אף טסט לא ננעל ל-`=520.0.0` (כולם `>=520`).

### מה לא אומת (חובת אמת)
- **72 cannotRun** — סוויטות שמצריכות vitest/ESM/dep שלא קיים בסביבה הזו.
  לא נחשבות עוברות ולא נכשלות. הבסיס לא השתנה.
- ה-`failClosed=false` masking של שגיאת audit מתועד בעוטף עצמו: בכוונה לא
  פולט שגיאה החוצה, רק `console.warn`. מתאים ל-handlers שאינם מזיזי כסף;
  לכל money-touching יש להעביר `failClosed: true`.
- העטיפה לא הוחלה על אף endpoint ייצור קיים ב-V520 — רק על endpoint דמו
  (`POST /api/v1/audit-wrap-v520/demo`). הצעד הבא (V521) הוא לבחור 1-3
  real-gaps מהטבלה ולהחיל עליהם את `wrapHandlerWithAudit520` בפועל.
- `CLASSIFICATIONS_520` כרגע מסווג רק 5 endpoints (2 false-positive, 3 exempt).
  כל היתר נשארים `unclassified` — לא טענה שאין פערים, אלא שעוד לא סווגו.
- לא בוצע benchmark — העטיפה מוסיפה append סינכרוני אחד ל-AuditLog בזיכרון
  (sha256 + JSON.stringify), עלות זניחה בפועל אך לא נמדדה רשמית.
