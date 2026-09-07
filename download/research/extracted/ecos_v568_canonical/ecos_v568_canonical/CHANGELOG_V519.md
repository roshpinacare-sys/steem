# CHANGELOG_V519.md

## V519 — Audit Completeness Probe (Phase P407)

### מה זוהה (Action D)
לפי NEXT_SESSION_PROMPT_V518 — Action C מוצה (אין מועמד פתוח חדש לרישום
ב-canonBridgePatch508). הצעד הבא: לסרוק את `ecos-api-server.js` ולגלות
אילו endpoints כספיים (mint/withdraw/transfer/settle/payout/disburse/royalty)
אינם עוברים דרך `guardMint402` / `guardWithdraw402` או דרך הוק `auditLog`.

לפני V519 לא היה דוח שמסמן את הפער בכלל — הופיע רק רישום פר endpoint
ידנית בכל patch. V519 מספק probe קריא-בלבד שמייצר תור-לבדיקה.

### מה נבנה
**`lib/auditCompletenessProbe519.js`** + מראה זהה ב-`src/lib/` (md5 = `67aa114b22961415061ab1d4c7eefff5`).

- `scanServer519()` — סורק את שורות `app.<verb>('<path>'…)` בקובץ השרת,
  מסווג נתיב כ-money-touching לפי טוקן (mint|withdraw|transfer|settle|
  payout|disburse|royalt), מסתכל על "גוף-מטפל" משוער (עד הראוט הבא,
  או 200 שורות) ובודק אם הוא מזכיר `guardMint402`/`guardWithdraw402`
  ו/או הוקי `auditLog`.
- `getProbeSummary519()` — תקציר ספירות. אפס רישומים ל-bridge508 (זה probe).
- `registerEndpoints519(app)` — 3 endpoints.
- IIFE `_wireAuditCompletenessProbe519` בסוף `ecos-api-server.js`
  (try/catch, לא-פטאלי).

**Endpoints חדשים:**
- `GET /api/v1/registry/audit-completeness-v519/status` — V519-T01
- `GET /api/v1/registry/audit-completeness-v519/full`   — V519-T02
- `GET /api/v1/admin/summary/v519`                       — V519-T03

**ממצאי הסריקה הראשונה (ייצור החדש — ספירות, לא verdict):**
- money-touching: **20**
- visible guard402: **2** (`/api/v1/guard/mint`, `/api/v1/guard/withdraw`)
- non-GET ללא guard נראה לעין: **12** (תור לבדיקה ידנית)
- non-GET ללא auditLog נראה לעין: **14** (תור לבדיקה ידנית)

חלקם לגיטימיים (למשל handlers שמעבירים דרך service שמוסיף audit פנימית),
חלקם פערים אמיתיים. ה-probe לא מחליט — הוא מסמן.

### אילוצים
- 0 npm deps חדשים. Node built-ins + require יחסי בלבד.
- SACRED לא נגעו (md5 fiatLedger/auditLog נשמרים, נבדק בטסט).
- אפס שינוי endpoints קיימים. אפס מחיקות. אפס שינוי לוגיקה.
- כל מזהה מסתיים ב-`519`. שיקוף ב-`src/lib/` בהעתק בייט-בייט (md5 זהה).
- fail-closed: handler לא מוכר ⇒ מסומן לבדיקה, לא מנוקה אוטומטית.

### תוצאות אימות (exit code בלבד)
| בדיקה | תוצאה |
|---|---|
| `node --check ecos-api-server.js` | ✅ PARSE_OK |
| SACRED md5 (fiatLedger, auditLog) | ✅ ללא דריפט |
| `NODE_ENV=test node tests/v519.test.js` | ✅ **14/14, exit 0** |
| `NODE_ENV=test node tests/v518.test.js` (רגרסיה) | ✅ **16/16, exit 0** (אחרי הרפיית assert של גרסה מדויקת) |
| `NODE_ENV=test node tests/v517.test.js` (רגרסיה) | ✅ **17/17, exit 0** |
| `node scripts/audit-tests.js` | ✅ **65 pass / 72 cannotRun / 0 realFail** (בסיס V518: 64/72/0) |

### שינויים בקבצים קיימים
- `package.json` → `"version": "519.0.0"`.
- `tests/v518.test.js` שורה אחת: `assert.strictEqual(pkg.version,'518.0.0')`
  → `major >= 518`. אין שינוי לוגי, רק הרפיה תואמת לחוק "אל תנעל לגרסה מדויקת".
- `ecos-api-server.js` — נוסף IIFE בסוף בלבד (אין שינוי endpoints קיימים).

### מה לא אומת
- **72 חבילות `cannotRun`** (vitest/ESM/חוסר deps) — זהה לבסיס V518, לא רגרסיה.
- ה-probe מבוסס regex על המקור — לא מבצע AST-walk. handlers שעטופים בפונקציה
  חיצונית (`createMintRoute(...)`) או שמעבירים דרך service שמוסיף guard/audit
  פנימית **לא יזוהו** כ-guarded ע"י ה-probe. לכן ה-22 endpoints המסומנים
  הם "תור לבדיקה" ולא רשימת באגים מאומתת.
- ה-endpoints החדשים נבדקו דרך stub של express בלבד (לא boot שרת מלא).
- חלון "גוף-מטפל" משוער כ-200 שורות עד הראוט הבא. handler ארוך במיוחד שהמשך-
  הלוגיקה שלו מעבר לזה — guard/audit ייתכן ולא ייספרו.

### הצעד הבא ל-V520
ראה `NEXT_SESSION_PROMPT_V519.md`. הצעה: לקחת 2-3 endpoints מהרשימה
`missingAudit=14` שהם באמת חוסר אמיתי (לא false-positive של ה-probe),
ולהוסיף `auditLog.append` בהם דרך מודול V520 נפרד — בלי לגעת ב-SACRED.
