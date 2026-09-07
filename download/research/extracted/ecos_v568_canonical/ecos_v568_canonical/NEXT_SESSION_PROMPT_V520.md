# NEXT_SESSION_PROMPT_V520.md — Start of V521

## Pre-flight
```bash
node scripts/audit-tests.js          # expect pass=66, cannotRun=72, realFail=0
node --check ecos-api-server.js      # PARSE_OK
NODE_ENV=test node tests/v520.test.js   # 22/22
NODE_ENV=test node tests/v519.test.js   # 14/14
NODE_ENV=test node tests/v518.test.js   # 16/16
md5sum lib/fiatLedger.js lib/auditLog.js
# 563e9b1f9e67091a5b6527c0a92568e5  lib/fiatLedger.js
# e5a5c2c27801d2d03991bc8e5a1df8cb  lib/auditLog.js
md5sum lib/auditWrap520.js src/lib/auditWrap520.js
# 45eb226354b367c47d07eacfc3321be8  (זהה בשני המקומות)
curl -s localhost:PORT/api/v1/admin/summary/v520 | jq '.summary'
curl -s localhost:PORT/api/v1/registry/audit-wrap-v520/real-gaps | jq '.report | {realGaps: (.realGaps|length), unclassified: (.unclassified|length)}'
```

## מצב ב-V520
- 520.0.0. `auditWrap520.js` נוסף (טבלת סיווג + עוטף audit + endpoint דמו).
- audit: **66 pass (+1), 72 cannotRun, 0 realFail.** SACRED נשמר.
- `CLASSIFICATIONS_520`: 2 false-positive (guard/mint, guard/withdraw),
  3 exempt (preview/quote/simulate). כל היתר → `unclassified` (fail-closed).
- `wrapHandlerWithAudit520` קיים ועובד (22/22 בדיקות כולל fail-closed,
  BigInt payload, סדר audit-before-handler). הוחל בפועל רק על endpoint דמו.

## הצעד הבא — V521

### מסלול 1 (מומלץ): החל את העוטף על real-gap אמיתי
1. הרץ `getRealGapList520()` והבא 3-5 endpoints מהרשימה `unclassified` או
   `realGaps`.
2. לכל endpoint: קרא את ה-handler בפועל ב-`ecos-api-server.js`, וקבע:
   - האם service פנימי כבר עושה audit? → הוסף ל-`CLASSIFICATIONS_520`
     כ-`false-positive` עם `reason`.
   - האם זה preview/quote? → `exempt`.
   - האם handler באמת לא כותב audit? → `real-gap`, ואז:
3. צור `lib/auditWrap521.js` שמייצא wrappers ספציפיים פר-endpoint
   (`wrapWithdrawHandler521`, `wrapTransferHandler521`, ...) — כל אחד עוטף
   את ה-handler המקורי עם `wrapHandlerWithAudit520(..., { failClosed: true,
   auditLog: defaultAuditLog })`.
4. ב-IIFE של V521, **רשום מחדש** את הראוט הספציפי עם ה-wrapper.
   Express יקרא לרישום האחרון — אבל זה דריסה ולא תמיד בטוח. הדרך הבטוחה:
   צור endpoint מקביל `*/v521` שמייצג את הגרסה ה-audited, השאר את הישן
   כפי שהוא, ובמטא-דאטה הצהר על ה-cutover.
5. הרץ את ה-probe שוב; ודא שהמספרים ירדו בדיוק כפי שצופה.

### מסלול 2: הרחב את הטבלה (Action D המשך)
- עבור ידנית על כל ה-12-14 endpoints שה-probe מסמן וסווג כל אחד ב-
  `CLASSIFICATIONS_520`. אין שינוי לוגיקה. רק טבלה גדלה.
- היעד: `unclassified === 0` בסוף V521. אפס פעולה אוטומטית — אם לא בטוח,
  השאר `unclassified`.

### מסלול 3 (לא דחוף): שדרג את ה-probe ל-AST
- regex של V519 מייצר false-positive. AST walk יזהה service wrappers.
- אזהרה: acorn / @babel/parser הם npm deps — אסור. אם יש כבר ב-node_modules
  בגלל dep אחר — מותר. אחרת — דלג.

## כללים (לא משתנים)
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-521. IIFE בסוף השרת. שיקוף בייט-בייט ב-`src/lib`.
- חובה סעיף "מה לא אומת" בתיעוד.
- כל endpoint שמוסיפים — חייב להיות `auditLog.append` בו (העוטף של V520
  בדיוק עושה את זה — השתמש בו).
- אל תנעל טסטים חדשים לגרסה מדויקת (`>=521`, לא `=521.0.0`).

## אזהרות
- אל תיגע ב-`lib/auditLog.js` (SACRED). השתמש ב-`defaultAuditLog` או
  ב-`new AuditLog()` בלבד.
- ה-`POST /api/v1/audit-wrap-v520/demo` נשאר חי כדי לאפשר בדיקה ידנית של
  השרשרת. אל תמחק אותו, גם אם הוא נראה "trivial" — הוא ההוכחה החיה.
- כשמחליפים handler ייצור עם wrapper, ודא ש-`failClosed: true`. אחרת
  סתם הוספת עוד שורת console.warn ולא סגרת את הפער.
