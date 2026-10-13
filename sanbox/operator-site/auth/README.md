# auth/ — מחולל-hash לאתחול-headless

## למה hash ולא סיסמה
השרת מאמת מול **hash scrypt** (N=16384, r=8, p=1, keylen=64) בלבד.
הסיסמה עצמה לעולם לא נשמרת בדיסק כטקסט, לא נכנסת לריפו, ולא מודפסת.

## שימוש (סוכנים / ללא-דפדפן)
```bash
OPERATOR_BOOTSTRAP_PASSWORD='...' bash auth/gen-hash.sh
```
כותב `../state/credentials.json` (git-ignored, mode 600) עם `{salt, hash}` בלבד.
הפורמט זהה למה שהשרת כותב ב-setup-דרך-הדפדפן — שתי-הדרכים ניתנות-להחלפה.

## איפוס
מחיקת `state/credentials.json` + הפעלה-מחדש = חלון-אתחול חדש (ברירת-מחדל 20 דק').
