# NEXT_SESSION_PROMPT_V472.md — Start of V473

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v472.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V472
- 472.0.0. `GET /api/v1/integrity/canon/status` + `GET /api/v1/admin/summary/v472`.
- economicIntegrityLoadBearing tower (LB361–LB371) מאוחד תחת `economicIntegrityCanon472.js`.
- SACRED תקין. 11/11 טסטים ירוקים.

## הצעד הבא בעל המינוף הגבוה ביותר

**V473: אחד את מגדל `agentDispatchBridge` (8 גרסאות: 246–253)**

זהו המגדל הבא בגודלו שמחובר לשרת ועדיין חסרה לו facade קנונית.

משימה:
1. `ls src/lib/agentDispatchBridge*.js | sort -V | tail -1` — זהה את ה-tip.
2. `tail -20 src/lib/agentDispatchBridge253.js` — ראה exports.
3. צור `agentDispatchBridgeCanon473.js` — facade דומה ל-`economicIntegrityCanon472.js`.
4. הוסף endpoint `GET /api/v1/agent/dispatch/canon/status`.
5. `tests/v473.test.js` exit 0 → `ecos_v473_canonical.zip`.

## כללים (ללא שינוי)
- פיצ'ר אחד, מחובר, מאומת.
- אפס npm deps חדשים. SACRED לא לגעת.
- כל מזהה מסתיים ב-473.
