# NEXT_SESSION_PROMPT_V479.md — Start of V480

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v479.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V479
- 479.0.0. `quadTowerCanon479.js` — facade ל-4 מגדלים (tipModule+telemetry+sybilGuard+splitModule), כל אחד V263–V268.
- SACRED intact. 13/13 ירוקים.

## מגדלים פתוחים — הבא בתור (V480)
הרץ: `ls lib/ | sed 's/[0-9].*$//' | sort | uniq -c | sort -rn | head -10`

מגדלים ידועים שעדיין ללא canon:
- `marketMaker` (×36) — שרשרת class inheritance, צריך canon facade (לא thin re-export)
- מגדלים ×6: `x` (8 versions) — בדוק מה זה
- בדוק אם Diamond heartbeat (V462/V465) עדיין פתוח

**המלצה הכי גבוהה-מינוף: `marketMakerCanon480.js`**
- marketMaker 333 הוא ה-tip. chain: 298→...→333
- facade שחושף רק את האינטרפייס של 333 (tip)
- לא thin re-export (chain class) — אלא wrapper/facade
- health + info + getCanonInfo480()
- 10+ tests, exit 0

## כללים
- פיצ'ר אחד, מחובר, מאומת. Zero npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-480. IIFE בסוף השרת.
