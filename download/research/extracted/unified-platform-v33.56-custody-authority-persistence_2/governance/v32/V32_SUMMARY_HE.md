# סיכום v32 — Roast לריבונות Credentials ו־Trust נייד

v32 תקף את ההנחה המרכזית שנותרה לאחר v31: שמפתח ציבורי רשום וחתימה תקינה מספיקים ליצירת סמכות. ההנחה הופרכה.

## תוצאות קנוניות

- 584/584 בדיקות עברו ב־115 קובצי בדיקה.
- 1,991 assertions נבדקו, ללא ממצא איכות בינוני, גבוה או קריטי.
- 16/16 מוטציות ריבונות נהרגו באופן אותנטי.
- 14/14 קצות אינטגרציה ו־14/14 מסלולי יכולת נסגרו.
- אפס מחזורי source ואפס מודולי source ללא בדיקה.
- כיסוי נשמר מעל שער השחרור: לפחות 99% שורות, 96% ענפים ו־98.5% פונקציות.
- שלוש הרצות יציבות מלאות עברו ללא flake וללא force-exit.

## הטענות שנדחו

1. **מפתח רשום רשאי להנפיק credential** — נדחה. סמכות הנפקה דורשת grant חתום מ־root pinned, מוגבל לסוג credential, tenant, scope וזמן.
2. **שני root keys הם שני גורמי שליטה עצמאיים** — נדחה. הסף נספר לפי custodians שונים וממופים חיצונית, לא לפי מספר מפתחות.
3. **predecessor chain לבדו מונע rollback offline** — הורד בדרגה. הוא מונע rollback דרך API, אך rollback דיסק דורש anchor נפרד.
4. **file anchor מקומי מגן גם מפני rollback משותף של bundle וה־anchor** — נדחה. לכך נדרש HSM, monotonic witness או federation חיצונית.
5. **חתימות threshold מוכיחות אמת** — נדחה. הן מוכיחות הרשאה וקישור לחומר בלבד.
6. **ביטול מפתח צריך למחוק יכולת אימות היסטורית** — נדחה. אימות לפי זמן שומר ראיות חוקיות מלפני הביטול וחוסם אמון מאוחר יותר.

## השלמות קוד

- Credential Issuer Trust עם root grants ו־grant revocation.
- רוטציה ומספר credentials לכל reviewer/provider.
- targeted revocation לפי credential digest.
- portable trust bundle עם public keys, grants, credentials, acceptance receipts ו־revocations.
- two-custodian threshold עם fingerprints ו־custodian pins.
- predecessor/fork checks, independent anchor ו־pending journal להתאוששות מקריסה.
- time-effective key revocation באמצעות `verifyAt` ו־`revokedAt`.
- הפרדת חוזי ProviderAuthorizer ו־ReviewerAuthorizer ממימוש security.

## גבול ההוכחה

כל ההוכחות מקומיות, single-host ומשתמשות במפתחות בדיקה. PostgreSQL, KMS/HSM, custodians חיצוניים, monotonic witness, ספק מודל חי, ערך אנושי, penetration test ורישוי עדיין אינם מוסמכים.

פסק הדין נשאר **Integrated Pilot** ו־Production promotion חסום.
