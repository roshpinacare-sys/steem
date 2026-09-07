# NEXT_SESSION_PROMPT_V509.md — Start of V510

## Pre-flight
```bash
node scripts/audit-tests.js    # expect 55 pass, 72 cannotRun
node --check ecos-api-server.js
NODE_ENV=test node tests/v509.test.js   # 11/11
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V509
- 509.0.0. `tipModuleCanon509` facade ל-tipModule tower (V263–V268).
- מסווג נכון כ-`parallel-duplicate` וצירף ל-canonBridgePatch508.
- **קדם-קיימות שלא טופלו**: v504, v506 realFail — לא קשורות ל-V509.

## הצעד הבא הכי בעל-מינוף

**V510: בדוק `telemetry` (6 גרסאות) — parallel-dup או chain?**

```bash
grep "require.*telemetry" lib/telemetry*.js | head -10
wc -l lib/telemetry*.js | sort -rn | head -5
```
- אם parallel → צור `telemetryCanon510.js`, register עם canonBridgePatch508.
- אם chain → דלג, בחר מגדל אחר.

**חלופה: תקן v504 realFail:**
```bash
NODE_ENV=test node tests/v504.test.js 2>&1 | grep "✗"
```
קרא את הכשל, תקן שורה בטסט (לא קובץ אחר), אמת exit 0.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-510. tests/v510.test.js exit 0 → zip.
