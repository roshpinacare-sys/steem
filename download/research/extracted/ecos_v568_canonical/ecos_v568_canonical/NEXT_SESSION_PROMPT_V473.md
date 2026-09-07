# NEXT_SESSION_PROMPT_V473.md — Start of V474

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v473.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V473
- 473.0.0. `agentDispatchBridgeCanon473.js` — facade ל-tower V246–V253.
- `GET /api/v1/agent/dispatch/canon/status` מחווט לשרת.
- SACRED תקין. 10/10 טסטים ירוקים.

## הצעד הבא בעל המינוף הגבוה ביותר

**V474: איחוד מגדל הבא — `meshDispatcher` (10 גרסאות)**

```
ls lib/ | grep meshDispatcher | sort -V
```
בדוק את ה-tip ואת exports שלו, בנה `meshDispatcherCanon474.js` facade,
הוסף endpoint `GET /api/v1/mesh/dispatcher/canon/status`,
וטסט `tests/v474.test.js` exit 0 → `ecos_v474_canonical.zip`.

## כללים (ללא שינוי)
- פיצ'ר אחד, מחובר, מאומת.
- אפס npm deps חדשים. SACRED לא לגעת.
- כל מזהה מסתיים ב-474.
