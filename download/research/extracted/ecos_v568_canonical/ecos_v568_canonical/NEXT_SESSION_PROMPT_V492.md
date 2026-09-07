# NEXT_SESSION_PROMPT_V492.md — Start of V493

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v492.test.js
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V492
- 492.0.0. שרשרת: `275Canon483→...→284Canon492 → V285+`. SACRED תקין. 11/11 ירוקים.

## הצעד הבא
**V493: בדוק אם V286 מייבא V285 ישירות → צור 285Canon493 shim**
```bash
grep "require.*providerAdapters285[^C]" lib/providerAdapters286.js
```
אם כן — אותו דפוס: `providerAdapters285Canon493.js`, עדכן V286, endpoint + test exit 0.

## כללים
Zero npm deps. SACRED. כל מזהה מסתיים ב-493. IIFE בסוף השרת.
