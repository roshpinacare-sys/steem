# NEXT_SESSION_PROMPT_V505 — Start of V506

## מצב ב-V505
- 505.0.0. governance.ok = true. GET /api/v1/status/v505 פעיל.
- 51/123 pass, 72 cannotRun, 0 realFail. SACRED intact.

## Pre-flight
```bash
node scripts/audit-tests.js
node --check ecos-api-server.js
NODE_ENV=test node tests/v505.test.js
md5sum lib/fiatLedger.js lib/auditLog.js
```

## הצעד הבא הכי בעל-מינוף: חיבור /api/v1/status לשרת ב-status505

כעת יש שני endpoints:
- `GET /api/v1/status` — עדיין קורא ל-systemStatus504 (governance.ok=false)
- `GET /api/v1/status/v505` — status505 תקין

**המשימה**: עדכן את ה-IIFE של V504 בשרת לשימוש ב-status505 במקום status504.

```bash
grep -n "status504\|require.*systemStatus504" ecos-api-server.js | tail -10
```

**שים לב**: אל תמחק את IIFE V504 — רק עדכן את `require` מ-`systemStatus504` ל-`systemStatus505`.
הוסף backwards-compat: `getSystemPosture504 = status505.getSystemPosture505`.

ודא שאחרי השינוי: `GET /api/v1/status` מחזיר `governance.ok=true`.
