# NEXT SESSION PROMPT V482 → V483

## מצב ב-V482
- 482.0.0. providerAdapters267 → thin re-export ל-Canon476. Bridge482 מרכז chain map + health.
- SACRED intact. 12/12 ירוקים.

## ממצא על השרשרת
**providerAdapters268-286 הן שרשרת require() אמיתית** — כל גרסה טוענת את קודמה עם symbols ממוספרים (למשל `PROVIDER_CONTRACTS_274`). thin re-export של אמצע השרשרת ישבור את ה-upper links.

**הפתרון לV483: נתק את השרשרת בנקודה אחת בלבד:**
1. **בדוק**: האם `providerAdapters274` (תחילת הסגמנט 274-286) מיובא ע"י מישהו חוץ מ-275?
   ```bash
   grep -rn "providerAdapters274" --include="*.js" . | grep -v "node_modules" | grep -v "274.js:\|275.js:" | head
   ```
2. אם אפס הפניות חיצוניות: הפוך את 274 ל-thin re-export ל-Canon476 **בלבד** —
   וכתוב גרסה חדשה `providerAdapters275Canon483.js` שמייבא **ישירות** מ-Canon476 (לא מ-274),
   ועדכן את 276 לייבא מ-275Canon483.
3. **אל תנגע ב-268/269/273** (ACTIVE_PATCH).
4. `GET /api/v1/towers/providers/chain` יחזיר את מצב החדש.

**חלופה פשוטה יותר (אם הסגמנט נראה סבוך):**
- צור `providerAdaptersAlias482.js` שעושה `module.exports = require('./providerAdaptersCanon476.js')` —
  ושמש אותו לכל **קוד חדש**, בלי לגעת בשרשרת הישנה.
