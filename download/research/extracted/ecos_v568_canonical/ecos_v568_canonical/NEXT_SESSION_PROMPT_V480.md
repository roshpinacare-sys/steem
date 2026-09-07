# NEXT_SESSION_PROMPT_V480.md — Start of V481

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v480.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V480
- 480.0.0. `pentaTowerCanon480.js` — facade ל-5 מגדלים (reputationLedger+reflectionLoop+quadraticFunding+offlineQueue+onboardingFlow), כל אחד V263–V268.
- SACRED intact. 15/15 ירוקים.

## מגדלים פתוחים — הבא בתור (V481)
הרץ: `ls lib/ | sed 's/[0-9].*$//' | sort | uniq -c | sort -rn | head -10`

מגדלים ידועים שעדיין ללא canon:
- `meshDispatcher` (×10) — בדוק את ה-tip ואם יש canon
- `economicIntegrityLoadBearing` (×11) — גדול ביותר, קריטי לשלמות כלכלית
- `agentDispatchBridge` (×8) — יש Canon473? בדוק שהוא מחובר לאורקסטרטור

**המלצה: `economicIntegrityLoadBearingCanon481.js`**
- 11 גרסאות ללא facade — הכי גדול ה-tower שנותר
- מצא את ה-tip (הגרסה הגבוהה ביותר)
- facade שחושף health + info + registerEndpoints481()
- 12+ tests, exit 0

## כללים
- פיצ'ר אחד, מחובר, מאומת. Zero npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-481. IIFE בסוף השרת.
