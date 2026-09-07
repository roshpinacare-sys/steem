# NEXT_SESSION_PROMPT_V494.md — Start of V495

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v494.test.js
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V494
- 494.0.0. שרשרת Canon shimים **מושלמת**: 275Canon483→...→286Canon494→Canon476.
- SACRED תקין. 11/11 ירוקים. chainComplete=true.

## הצעד הבא
שרשרת providerAdapters סגורה. V495 יכול לבחון מגדל אחר:
```bash
# חפש מגדל שכפול אחר בפרויקט
ls lib/*.js | sed 's/[0-9]*\.js//' | sort | uniq -c | sort -rn | head -10
```
אם קיים מגדל >3 מודולים לאותו תפקיד — החל Canon shim שם.
אחרת — סרוק קבצים כבדים/patch ישנים לפי שלב A.

## כללים
Zero npm deps. SACRED. כל מזהה מסתיים ב-495. IIFE בסוף השרת.
