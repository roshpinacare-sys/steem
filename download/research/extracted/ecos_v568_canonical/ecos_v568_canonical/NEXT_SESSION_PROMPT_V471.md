# NEXT_SESSION_PROMPT_V471.md — Start of V472

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v471.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V471
- 471.0.0. `GET /api/v1/mesh/dispatch/status` מאחד canon470 + D297 runtime stats.
- meshDispatcher tower (D288-D297 + canon470) — מחובר ומתועד.
- SACRED תקין. 15/15 טסטים ירוקים.

## הצעד הבא בעל המינוף הגבוה ביותר

**V472: התחל לאחד את מגדל marketMaker (36 וריאנטים!)**

זהו המגדל הגדול ביותר במערכת (36 קבצים). לפי סדר הכרעה B בפרומט — איחוד קודם לפיתוח חדש.

משימה מומלצת:
1. זהה את ה-canonical tip — `ls src/lib/ | grep marketMaker | sort -V | tail -3`
2. צור `marketMakerCanon472.js` — facade דומה ל-`meshDispatcherCanon470.js`
3. הוסף endpoint `GET /api/v1/market/maker/canonical` שמחזיר tower metadata
4. **אל תשנה שום IIFE קיים** — הוסף בלבד

## כללים (ללא שינוי)
- פיצ'ר אחד, מחובר, מאומת.
- אפס npm deps חדשים. SACRED לא לגעת.
- `tests/v472.test.js` exit 0 → `ecos_v472_canonical.zip`.
