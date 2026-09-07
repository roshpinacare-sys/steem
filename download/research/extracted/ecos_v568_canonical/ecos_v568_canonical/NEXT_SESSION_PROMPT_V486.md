# NEXT_SESSION_PROMPT_V486.md — Start of V487

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v486.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V486
- 486.0.0. שרשרת: `275Canon483 → 276Canon484 → 277Canon485 → 278Canon486 → V279+`.
- V279 מייבא מה-shim (לא מ-278 ישירות). SACRED תקין. 10/10 ירוקים.

## הצעד הבא הכי בעל-מינוף

**V487: בדוק אם V280 מייבא V279 ישירות → צור 279Canon487 shim**

```bash
grep "require.*providerAdapters279" lib/providerAdapters280.js
```
אם כן — העתק דפוס canon486, צור `providerAdapters279Canon487.js`, עדכן V280.
בדוק גם: `ls lib/ | grep providerAdapters | sort -V | tail -5`
לראות עד כמה השרשרת ממשיכה ומה ה-tip הנוכחי.

## כללים
- אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-487. src/lib + lib זהים.
- `tests/v487.test.js` exit 0 → `ecos_v487_canonical.zip`.
