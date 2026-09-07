# NEXT_SESSION_PROMPT_V476.md — Start of V477

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v476.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V476
- 476.0.0. `providerAdaptersCanon476.js` — facade ל-17 מודולי providerAdapters (V267–V286, 36 contracts).
- `GET /api/v1/provider-adapters/canon/status` + `GET /api/v1/admin/summary/v476`.
- SACRED intact. 11/11 ירוקים.

## מגדלים פתוחים — הבא בתור (V477)

הרץ: `ls lib/ | grep -v Canon | sed 's/[0-9].*$//' | sort | uniq -c | sort -rn | head -5`

מגדלים פתוחים גדולים (ללא Canon):
- `economicIntegrityLoadBearing` (11) — המגדל הגדול הבא
- `meshDispatcher` (10)
- `agentDispatchBridge` (8)

**המלצה: `economicIntegrityLoadBearingCanon477.js`**
- בנה facade ל-11 מודולי economicIntegrityLoadBearing
- `GET /api/v1/economic-integrity/canon/status`
- 10/10+ tests, exit 0

## כללים
- פיצ'ר אחד, מחובר, מאומת. Zero npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-477. IIFE בסוף השרת.
