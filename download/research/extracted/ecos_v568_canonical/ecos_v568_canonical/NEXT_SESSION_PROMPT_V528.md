# NEXT_SESSION_PROMPT_V528 — תחילת V529

## מצב ב-V528
- גרסה 528.0.0. audit: **123 pass / 21 cannotRun / 0 realFail**. זיפ נקי (~5-6MB; הוסר ניפוח 19MB).
- נבנה globals shim (node_modules/vitest/globals.cjs) — הוריד cannotRun 28→21.
- תוקן באג MMR inclusion-proof אמיתי (posInPeak חסר ב-generateProof).
- כל ה-realFail נסגרו (כולל v510).

## ⚠️ Pre-flight
```
node scripts/audit-tests.js   # פעמיים (v510 קורא snapshot). יעד: 123/21/0
node --check ecos-api-server.js
NODE_ENV=test node tests/v528.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- SACRED לא לגעת; lib משקף src/lib; אפס npm חדש; בלי קינון/patch. אמת > רושם.

## ⛔ 21 ה-cannotRun שנותרו — צריכות חבילות npm אמיתיות (לא לזייף!)
- **19× `pg`** (postgres) · **1× `ws`** · **1× `commander`**.
- אלו תלויות infra אמיתיות. stub מזויף ל-pg יהפוך 19 ל-realFail כוזב — אל תעשה את זה.
- הדרך הנכונה: בסביבה עם רשת — `npm i pg ws commander` ואז `node scripts/audit-tests.js`. כך יתאמתו 21.
- אם רוצים אופליין: לבנות in-memory pg אמיתי (לא stub ריק) שמדמה את ה-SQL — פרויקט גדול בפני עצמו.

## הצעד הבא (V529 — בחר אחד)
1. commander (1) — לוונדר stub מינימלי אמיתי (arg parser). סיכון נמוך, +1 pass אפשרי.
2. לאחד את systemStatus504/505 הכפולים (אם parallel-dup ללא הפניות).
3. כל realFail חדש שה-audit חושף — תקן קודם.

## מה לא אומת (העבר הלאה)
21 cannotRun = pg×19 / ws×1 / commander×1. ה-globals shim הוא שכבת-תאימות, לא vitest מלא.

## אריזה
`ecos_v529_canonical.zip`, שורש `ecos_v529_canonical/`.
