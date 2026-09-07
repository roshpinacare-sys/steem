# NEXT_SESSION_PROMPT_V511.md — Start of V512

## Pre-flight
```bash
node scripts/audit-tests.js    # expect pass=57, cannotRun=72, realFail=0
node --check ecos-api-server.js
NODE_ENV=test node tests/v511.test.js   # 10/10
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V511
- 511.0.0. `telemetryCanon511.js` — facade ל-6 מודולי telemetry (V263–V268).
- audit: pass=57, cannotRun=72, realFail=0. SACRED intact.

## הצעד הבא
**V512: בדוק מגדל sybilGuard**
```bash
ls lib/ | grep sybilGuard | sort -V
grep "require.*sybilGuard" lib/sybilGuard*.js | head -8
```
- parallel (אין require בין הגרסאות) → `sybilGuardCanon512.js` facade.
- chain → בחר מגדל אחר.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-512. tests/v512.test.js exit 0 → zip.
- דווח: X/Y pass, Z cannotRun, W realFail — מספרים בלבד.
