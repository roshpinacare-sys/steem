# NEXT_SESSION_PROMPT_V508.md — Start of V509

## Pre-flight
```bash
node scripts/audit-tests.js    # expect 54 pass, 72 cannotRun, 0 realFail
node --check ecos-api-server.js
NODE_ENV=test node tests/v508.test.js   # 15/15
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V508
- 508.0.0. `canonBridgePatch508` מחבר Canon facades ל-Bridge496.
- reflectionLoop תוקן: inheritance-chain→parallel-duplicate, trueRetirable 0→5.
- 54 pass, 72 cannotRun, 0 realFail. SACRED תקין.

## הצעד הבא הכי בעל-מינוף

**V509: בדוק tipModule (6 גרסאות) ורשום ב-canonBridgePatch**

```bash
# בדוק אם parallel-dup או inheritance-chain:
grep "require.*tipModule" lib/tipModule*.js | head -10
# אם parallel: צור tipModuleCanon509 + registerCanonFacade508 call
# אם chain: דלג — לא בטוח לאחד
```

אם parallel-dup:
1. `wc -l lib/tipModule*.js | sort -rn | head -3` — מצא את הגדול ביותר (הקנוני).
2. צור `tipModuleCanon509.js` עם `getTowerDescriptor509()`.
3. הוסף `registerCanonFacade508(tipModuleCanon509.getTowerDescriptor509())` לתוך IIFE של V509.
4. בדוק: `getKindDiff508` מכיל עכשיו גם tipModule אם bridge מסווג אותו שגוי.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-509. tests/v509.test.js exit 0 → zip.
