# NEXT_SESSION_PROMPT_V527 — תחילת V528

## מצב ב-V527
- גרסה 527.0.0. audit מלא: **117 pass / 28 cannotRun / 0 realFail** (היה 111/28/5 ב-v526).
- נבנו מודולים אמיתיים שהיו חסרים: lib/rails/{manualRail,stripeRail,bankTransferRail}, monitor/index.js.
- ה-shim הוונדורי (node_modules/vitest) הורחב: mock matchers + vi.spyOn אמיתי.
- v510 T09 תוקן (ההנחה cannotRun≥70 התיישנה הודות ל-shim).
- SACRED שלם; node --check נקי; tests/v527.test.js? (אם אין — זה גרסת-תיקונים, הטסטים שתוקנו הם העדות).

## ⚠️ Pre-flight (קודם כל — audit מלא)
```
node scripts/audit-tests.js   # פעמיים (v510 קורא snapshot). יעד: 117/28/0
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- SACRED לא לגעת; lib משקף src/lib; suffix NNN; אפס תלויות npm; בלי קינון/patch.
- אמת: דווח X pass / Y cannotRun / Z realFail. לעולם לא "הכל ירוק".

## הצעד הבא (V528 — בחר אחד; ה-audit מדריך)
1. **הרחב את ה-shim ל-globals**: חלק מ-28 ה-cannotRun משתמשות ב-describe/it/expect כ-globals (בלי import).
   הזרק אותם ל-globalThis ב-shim. הרץ audit — צפה ל-cannotRun יורד.
2. **אחד את systemStatus504/505** (זוג כפול טרי) — thin re-export אם זה parallel-dup ללא הפניות.
3. תיקון כשל אמיתי נוסף אם ה-audit חושף.

## מה לא אומת (העבר הלאה)
28 cannotRun (vitest-globals / pg / commander). ה-shim הוא שכבת-תאימות, לא vitest מלא.

## אריזה
`ecos_v528_canonical.zip`, שורש `ecos_v528_canonical/`.
