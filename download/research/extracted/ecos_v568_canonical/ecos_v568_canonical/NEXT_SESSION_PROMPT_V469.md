# NEXT SESSION PROMPT V469 → V470

## המצב הנוכחי
- V469 סיים Priority A (ניקוי 13 patch מנותקים v274-v286) + Priority B (Tower Registry).
- `GET /api/v1/registry/consolidate` זמין ומחזיר 33+ מגדלים.
- SACRED תקין, 10/10 טסטים, server parse-נקי.

## הצעד הבא הכי בעל-מינוף

**Priority B המשך: איחוד מגדל meshDispatcher (10 מודולים: 288-297)**

הוא מגדל **שרשרת** (כל מודול require()-ת את קודמו), לא מגדל-עצמאיים.
לכן הגישה: **אל תמחק אף מודול** — רק:
1. צור `src/lib/meshDispatcherCanon469.js` שמייצא את V297 כ-canonical facade:
   ```js
   module.exports = require('./meshDispatcher297.js');
   ```
2. הוסף endpoint אחד בשרת: `GET /api/v1/mesh/dispatch/canonical` שמשתמש **רק** ב-meshDispatcher297, לא ב-288-296.
3. רשום ב-`GET /api/v1/registry/consolidate` שה-canonical נקבע.

**אל תשנה את ה-IIFEs הקיימים** שכבר משתמשים ב-D288..D297 — הם קיימים, עובדים, אל תשבר.

**כללים קשיחים**
- בדוק `node --check` אחרי כל שינוי.
- SACRED md5 חובה לפני ואחרי.
- exit 0 לטסטים לפני אריזה.
