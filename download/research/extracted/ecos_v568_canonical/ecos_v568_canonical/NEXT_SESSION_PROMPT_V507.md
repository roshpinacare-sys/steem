# NEXT_SESSION_PROMPT_V507.md — Start of V508

## Pre-flight
```bash
node scripts/audit-tests.js    # expect 53 pass, 72 cannotRun, 0 realFail
node --check ecos-api-server.js
NODE_ENV=test node tests/v507.test.js   # 23/23
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V507
- 507.0.0. `reflectionLoopCanon507` — facade ל-reflectionLoop tower (6 vars, V263–V268 parallel-dup).
- SACRED תקין. 23/23 ירוקים. 53 pass, 72 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף

**V508: חבר את `reflectionLoopCanon507` ל-`registryConsolidationBridge496`**

הבעיה: `registerExternalTower` לא קיים ב-bridge. פתרון:
1. בדוק את ה-API המדויק של `registryConsolidationBridge496` (head -60 lib/).
2. השתמש בשיטה הנכונה (אולי `getConsolidationReport` מחזיר towers — הוסף reflectionLoop אליו).
3. לחלופין: צור `tipModuleCanon508` (6 וריאנטים, בדוק parallel-dup) — הצלבה ל-reflectionLoop.

**אזהרה**: inheritance-chain → אל תהפוך ל-thin re-export. בדוק קודם.

## כללים
- exit code only. דווח מספרים אמיתיים.
- אפס npm deps. SACRED לא לגעת. tests/v508.test.js exit 0 → zip.
