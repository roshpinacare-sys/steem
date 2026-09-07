# NEXT SESSION PROMPT V470 → V471

## המצב הנוכחי
- V470 הצהיר על `meshDispatcherCanon470.js` כ-canonical facade לשרשרת D288-D297.
- `GET /api/v1/mesh/dispatch/canonical` פעיל ומחזיר tower metadata.
- SACRED תקין, 10/10 טסטים, server parse-נקי.

## הצעד הבא הכי בעל-מינוף

**עדכון IIFEs בשרת לשימוש ב-canon470 במקום ייבואי D288..D296 ישירים**

בשרת קיימים ~10 IIFEs שמבצעים `require('./lib/meshDispatcher288.js')` וכו' ישירות.
המשימה:
1. זהה את ה-IIFE האחרון (V297 - שורות ~25535-25680 בשרת) — הוא כבר משתמש ב-D297.
2. הוסף לתוכו שימוש ב-`canon470.getCanonInfo470()` בתוך endpoint קיים (אל תשבור!).
3. צור endpoint חדש אחד: `GET /api/v1/mesh/dispatch/status` — מאחד status מ-D297 + canon470.

**כלל קשיח**: אל תשנה IIFEs ישנים (V288..V296) — הוסף בלבד לחלק D297/V470.

## כללים קשיחים
- `node --check` אחרי כל שינוי
- SACRED md5 חובה לפני ואחרי
- exit 0 לטסטים לפני אריזה
