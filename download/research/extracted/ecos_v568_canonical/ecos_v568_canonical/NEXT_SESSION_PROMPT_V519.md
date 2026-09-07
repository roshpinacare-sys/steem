# NEXT_SESSION_PROMPT_V519.md — Start of V520

## Pre-flight
```bash
node scripts/audit-tests.js          # expect pass=65, cannotRun=72, realFail=0
node --check ecos-api-server.js      # PARSE_OK
NODE_ENV=test node tests/v519.test.js   # 14/14
NODE_ENV=test node tests/v518.test.js   # 16/16
NODE_ENV=test node tests/v517.test.js   # 17/17
md5sum lib/fiatLedger.js lib/auditLog.js
# 563e9b1f9e67091a5b6527c0a92568e5  lib/fiatLedger.js
# e5a5c2c27801d2d03991bc8e5a1df8cb  lib/auditLog.js
md5sum lib/auditCompletenessProbe519.js src/lib/auditCompletenessProbe519.js
# 67aa114b22961415061ab1d4c7eefff5  (זהה בשני המקומות)
curl -s localhost:PORT/api/v1/registry/audit-completeness-v519/full | jq '.report.totals'
```

## מצב ב-V519
- 519.0.0. `auditCompletenessProbe519.js` נוסף (read-only probe, 0 רישומים).
- audit: 65 pass (+1), 72 cannotRun, 0 realFail. SACRED נשמר.
- ה-probe מסמן 20 endpoints money-touching, מתוכם 2 בעלי guard נראה לעין,
  12 non-GET ללא guard נראה לעין, ו-14 non-GET ללא auditLog נראה לעין.

## למה Action D ממשיך להיות מועמד טבעי
ה-probe מספק תור-לבדיקה אמיתי לראשונה — לפני V519 לא היה דוח כזה.
המספרים גולמיים: חלק מה-22 הם false-positive של ה-regex (service מעטיף
שמוסיף guard/audit פנימית). הצעד הבא צריך להוריד את ה-false-positives
ולסגור את הפערים האמיתיים.

## הצעד הבא — V520 — שני מסלולים אפשריים

### מסלול 1 (מומלץ): Action D — תיקון פערים נקודתי
1. הרץ `getProbeSummary519()` + `scanServer519()` והבא 3-5 endpoints
   שמסומנים `needsAuditReview=true`.
2. לכל endpoint קבע ידנית: false-positive (כבר עובר audit ב-service פנימית)
   או real-gap.
3. ל-real-gaps: צור `lib/auditWrap520.js` עם `wrapHandlerWithAudit520(handler, {kind, source})`
   שמייצר עטיפה דקה — לפני קריאה ל-handler המקורי מבצע
   `auditLog.append({kind, source, payload})`. אל תגע ב-`lib/auditLog.js` עצמו (SACRED).
4. ב-IIFE של V520, החלף את הראוטים הספציפיים ב-wrapped version
   (override על אותו path עם אותו verb — Express יקרא ל-last-registered;
   אם זה לא מספיק — צור endpoints חדשים `*/v520` במקביל ובדוק שזה רישום
   ולא דריסה).
5. הרץ את ה-probe שוב, ודא שהמספר ירד בדיוק במספר ה-endpoints שטיפלת בהם.

### מסלול 2: שדרג את ה-probe ל-AST
החלף את ה-regex ב-AST walk קל (`acorn` או parser ב-Node built-in דרך
`vm.Script` עם דגלי-syntax). זה יזהה wrappers ויוריד false-positives.
**אזהרה:** acorn זה npm dep — אסור. אם בוחרים, צריך parser שכבר קיים
ב-node_modules או לוותר.

## כללים (לא משתנים)
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-520. IIFE בסוף השרת. שיקוף בייט-בייט ב-`src/lib`.
- חובה סעיף "מה לא אומת" בתיעוד.
- כל endpoint שמוסיפים — חייב להיות `auditLog.append` בו (חלק מהמסלול הוא לסגור גם את הפער הזה לעצמך).
- אל תנעל טסטים חדשים לגרסה מדויקת (`>=520`, לא `=520.0.0`).

## אזהרה
ה-probe קריא-בלבד. אל תהפוך אותו ל-enforcer (חסימת boot על gap), זה ישבור
שרתים חיים שיש בהם false-positive. תמיד flag + report + עוקפ-ידנית.
