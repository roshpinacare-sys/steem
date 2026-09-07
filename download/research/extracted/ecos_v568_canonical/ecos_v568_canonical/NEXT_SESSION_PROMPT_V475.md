# NEXT_SESSION_PROMPT_V475.md — Start of V476

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v475.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V475
- 475.0.0. `marketMakerCanon475.js` — facade ל-36 מודולי marketMaker (V298–V333).
- `GET /api/v1/market-maker/canon/status` + `GET /api/v1/admin/summary/v475`.
- SACRED intact. 11/11 ירוקים.

## הצעד הבא בעל המינוף הגבוה ביותר

**V476: מגדל הבא** — הרץ:
```
ls lib/ | grep -v Canon | sed 's/[0-9].*$//' | sort | uniq -c | sort -rn | head -5
```
מגדלים פתוחים גדולים (ללא Canon):
- `providerAdapters` (17) — שני המגדלים הגדולים הבאים
- `economicIntegrityLoadBearing` (11)

בנה `<name>Canon476.js`, הוסף `GET /api/v1/<name>/canon/status`,
טסט 10/10+ exit 0.

## כללים
- פיצ'ר אחד, מחובר, מאומת. Zero npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-476. IIFE בסוף השרת.
