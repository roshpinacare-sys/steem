# NEXT_SESSION_PROMPT_V485.md — Start of V486

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v485.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V485
- 485.0.0. שרשרת shim: `275Canon483 → 276Canon484 → 277Canon485 → V278+`.
- V278 מייבא מה-shim (לא מ-V277 ישירות). SACRED תקין. 14/14 ירוקים.

## הצעד הבא הכי בעל-מינוף

**V486: בדוק אם V279 מייבא V278 ישירות → צור 278Canon486 shim**

```bash
grep "require.*providerAdapters278" lib/providerAdapters279.js
```
אם כן — העתק דפוס canon485, צור `providerAdapters278Canon486.js`, עדכן V279.

## כללים
- אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-486. src/lib + lib זהים.
- `tests/v486.test.js` exit 0 → `ecos_v486_canonical.zip`.
