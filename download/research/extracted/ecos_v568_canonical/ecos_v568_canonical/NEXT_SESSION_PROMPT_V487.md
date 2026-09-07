# NEXT_SESSION_PROMPT_V487.md — Start of V488

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v487.test.js
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V487
- 487.0.0. שרשרת שימים: `275Canon483→276Canon484→277Canon485→278Canon486→279Canon487→V280+`.
- SACRED תקין. 10/10 ירוקים.

## הצעד הבא
**V488: בדוק אם V281 מייבא V280 ישירות → צור 280Canon488 shim**
```bash
grep "require.*providerAdapters280[^C]" lib/providerAdapters281.js
```
אם כן — אותו דפוס: `providerAdapters280Canon488.js`, עדכן V281, endpoint + test exit 0.

## כללים
- Zero npm deps. SACRED. כל מזהה מסתיים ב-488. IIFE בסוף השרת.
