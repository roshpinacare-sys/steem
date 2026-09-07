# NEXT_SESSION_PROMPT_V484.md — Start of V485

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v484.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V484
- 484.0.0. שרשרת shim: `275Canon483 → 276Canon484 → V277+`.
- V277 מייבא מה-shim (לא מ-V276 ישירות). SACRED תקין. 19/19 ירוקים.

## הצעד הבא הכי בעל-מינוף

**V485: בדוק אם V278 מייבא V277 ישירות → צור 277Canon485 shim**

```bash
grep "require.*providerAdapters277" lib/providerAdapters278.js
```
אם כן — העתק דפוס canon484, צור `providerAdapters277Canon485.js`, עדכן V278.

## כללים
- אפס npm deps. SACRED לא לגעת.
- `tests/v485.test.js` exit 0 → `ecos_v485_canonical.zip`.
