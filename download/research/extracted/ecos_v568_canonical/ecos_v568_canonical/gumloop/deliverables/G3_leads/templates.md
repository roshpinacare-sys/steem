# G3 — Outreach Templates (executed 2026-05-31)

> 25 לידים אמיתיים ב-`data/growth/validator_leads.jsonl` (Apollo, 23 עם אימייל).
> אימיילים מעורפלים עד enrich (חוסך קרדיט). לפני שליחה: הרץ `find_people enrich=true` או import בבטץ'.

## תבנית 1 — אימייל קר (קצר)
**Subject:** You verified AI for years. Now own the upside.

Hi {first_name},
You've spent your career making complex systems trustworthy. ECOS pays senior
technologists to verify uncertain AI outputs — and when your correction becomes a
reusable knowledge patch, you earn **royalties every time it's reused. Forever.**
Not gig work. Ownership. 100 free credits to start.
Worth a 15-min look? — {your_name}

## תבנית 2 — LinkedIn (DM)
היי {first_name}, בונים את שכבת האמון ל-AI: ולידטורים בכירים מאמתים פלטים לא-ודאיים,
ומי שכותב תיקון טוב הופך לבעלים שמקבל תמלוגים על כל שימוש חוזר. מחפשים validators מייסדים.
פתוח לשיחה קצרה?

## כללי שימוש
- שדה `stage` ב-feed: new→contacted→signed→active. עדכן ע"י `scripts/import-validator-leads.mjs`.
- אסור מענק כפול: ה-import בודק email קיים לפני signup.
