# NEXT_SESSION_PROMPT_V474.md — Start of V475

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v474.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V474
- 474.0.0. `meshDispatcherCanon474.js` — facade משודרג עם `getHealthSummary474` + `dispatchCapability474`.
- `GET /api/v1/mesh/dispatcher/canon/status` + `POST /api/v1/mesh/dispatcher/dispatch/v474`.
- SACRED תקין. 10/10 ירוקים.

## הצעד הבא בעל המינוף הגבוה ביותר

**V475: איחוד מגדל הבא** — הרץ:
```
ls lib/ | grep -v Canon | sed 's/[0-9].*$//' | sort | uniq -c | sort -rn | head -5
```
מצא את המגדל הבא (>3 גרסאות ללא facade), בנה `<name>Canon475.js`,
הוסף `GET /api/v1/<name>/canon/status`, טסט 10/10 exit 0.

## כללים (ללא שינוי)
- פיצ'ר אחד, מחובר, מאומת. Zero npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-475. IIFE בסוף השרת.
