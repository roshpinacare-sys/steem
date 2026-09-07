# NEXT_SESSION_PROMPT_V490.md — Start of V491

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v490.test.js
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V490
- 490.0.0. שרשרת shimים: `275Canon483→...→282Canon490 → V283+`.
- SACRED תקין. 11/11 ירוקים.

## הצעד הבא
**V491: בדוק אם V284 מייבא V283 ישירות → צור 283Canon491 shim**
```bash
grep "require.*providerAdapters283[^C]" lib/providerAdapters284.js
```
אם כן — אותו דפוס: `providerAdapters283Canon491.js`, עדכן V284, endpoint + test exit 0.

## כללים
- Zero npm deps. SACRED. כל מזהה מסתיים ב-491. IIFE בסוף השרת.
