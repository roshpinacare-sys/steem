# NEXT_SESSION_PROMPT_V491.md — Start of V492

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v491.test.js
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V491
- 491.0.0. שרשרת: `275Canon483→...→283Canon491 → V284+`. SACRED תקין. 11/11 ירוקים.

## הצעד הבא
**V492: בדוק אם V285 מייבא V284 ישירות → צור 284Canon492 shim**
```bash
grep "require.*providerAdapters284[^C]" lib/providerAdapters285.js
```
אם כן — אותו דפוס: `providerAdapters284Canon492.js`, עדכן V285, endpoint + test exit 0.

## כללים
Zero npm deps. SACRED. כל מזהה מסתיים ב-492. IIFE בסוף השרת.
