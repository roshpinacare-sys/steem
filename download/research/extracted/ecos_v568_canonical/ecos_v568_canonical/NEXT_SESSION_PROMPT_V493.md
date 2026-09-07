# NEXT_SESSION_PROMPT_V493.md — Start of V494

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v493.test.js
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V493
- 493.0.0. שרשרת: `275Canon483→...→285Canon493 → V286+`. SACRED תקין. 11/11 ירוקים.

## הצעד הבא
**V494: בדוק אם V287 מייבא V286 ישירות → צור 286Canon494 shim**
```bash
grep "require.*providerAdapters286[^C]" lib/providerAdapters287.js
```
אם כן — אותו דפוס: `providerAdapters286Canon494.js`, עדכן V287, endpoint + test exit 0.

## כללים
Zero npm deps. SACRED. כל מזהה מסתיים ב-494. IIFE בסוף השרת.
