# NEXT_SESSION_PROMPT_V510.md — Start of V511

## Pre-flight
```bash
node scripts/audit-tests.js    # expect pass=56, cannotRun=72, realFail=0
node --check ecos-api-server.js
NODE_ENV=test node tests/v510.test.js   # 10/10
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V510
- 510.0.0. תוקנו 2 realFail ישנים: v504+v506. audit נקי: realFail=0, pass=55, cannotRun=72.
- SACRED תקין. 10/10 ירוקים.

## הצעד הבא הכי בעל-מינוף

**V511: בדוק telemetry tower**
```bash
ls lib/ | grep telemetry | sort -V
grep "require.*telemetry" lib/telemetry*.js | head -8
```
- אם parallel (אין require-chain בין הגרסאות) → `telemetryCanon511.js` facade.
- אם chain (כל גרסה מרחיבה קודמת) → דלג, בחר מגדל אחר.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-511. tests/v511.test.js exit 0 → zip.
- דווח: X/Y pass, Z cannotRun, W realFail — מספרים בלבד.
