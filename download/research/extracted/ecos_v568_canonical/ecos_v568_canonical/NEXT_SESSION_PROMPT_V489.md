# NEXT_SESSION_PROMPT_V489.md — Start of V490

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v489.test.js
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V489
- 489.0.0. שרשרת shimים: `275Canon483→...→281Canon489 → V282+`.
- SACRED תקין. 11/11 ירוקים.

## הצעד הבא
**V490: בדוק אם V283 מייבא V282 ישירות → צור 282Canon490 shim**
```bash
grep "require.*providerAdapters282[^C]" lib/providerAdapters283.js
```
אם כן — אותו דפוס: `providerAdapters282Canon490.js`, עדכן V283, endpoint + test exit 0.

## כללים
- Zero npm deps. SACRED. כל מזהה מסתיים ב-490. IIFE בסוף השרת.
