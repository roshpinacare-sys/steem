# הוראות-מפעיל: טוקן-קלאסי לפרסום-חבילות (write:packages) — 5 דקות

**רקע בשורה אחת**: ה-PAT הקיים הוא fine-grained על חשבון-אישי — ל-GitHub **אין** אפשרות
לתת לו Packages על חשבון-אישי (ההרשאה קיימת בממשק רק תחת Organization permissions).
זו הסיבה שלא מצאת "Packages" — זה לא נמצא, כי הוא לא קיים שם. הנתיב-היחיד = טוקן-קלאסי.
(הוכחה-חיה: E403 שלוש פעמים — האחרונה 2026-10-07T20:27:53Z.)

## הצעדים (בדיוק)

1. GitHub → תמונת-פרופיל → **Settings**
2. (בסרגל-השמאלי, בתחתית) → **Developer settings**
3. → **Personal access tokens** → **Tokens (classic)** ← לא fine-grained!
4. **Generate new token** → **Generate new token (classic)**
5. Note: `saos-packages-publish`
6. Expiration: `30 days` (מומלץ — תוקף-קצר = סיכון-קטן)
7. סימון-סקופים: **רק** ☑ `write:packages` (מסמן-אוטומטית `read:packages`)
   ⛔ **אל תסמן** `repo`, `admin`, `workflow` — לא צריך ולא בריא
8. **Generate token** → העתק את ה-`ghp_...`
9. שמור במכונה: צור קובץ `upload/pat-classic.env` שבו שורה-אחת = הטוקן החשוף (בלי מרכאות).
   התיקייה `upload/` כבר מנותקת-מגיט לחלוטין (`.gitignore:57`) — לא ייצא לעולם.
10. אמור לי: "הטוקן-הקלאסי מוכן" — ואני אריץ `bash scripts/publish-github-packages.sh`
    ואז החבילה `@roshpinacare-sys/saos-agents@0.1.0` תעלה עכשיו.

## למה זה בטוח (הבקשה שלך על זהירות)

- **סקופ-יחיד** (`write:packages`) — לטוקן אין גישה לקוד/ריפו/הגדרות; גם אם יידלף, נזקו ≈ 0.
- **תוקף 30 יום** — מתאדה מעצמו.
- GitHub **סורקת סודות אוטומטית** — אם טוקן ידלוף לריפו-ציבורי היא משלילה אותו מעצמה
  (זה מה שעשו אצלך פעם) ומודיעה; השער-המקומי שלנו (G1–G3) מקדים זאת בכל דחיפה.
- אפשר לשלול מיד אחרי הפרסום (Settings → Tokens (classic) → Delete) — החבילה כבר עלתה.
