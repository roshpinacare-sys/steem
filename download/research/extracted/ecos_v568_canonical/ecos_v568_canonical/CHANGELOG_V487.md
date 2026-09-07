# CHANGELOG_V487.md — providerAdapters279 Canonical Shim

## מה זוהה
V280 ייבא `providerAdapters279` ישירות — קישור לא-מתווך שעוקף את שרשרת השימים.
שרשרת V487: `275Canon483 → 276Canon484 → 277Canon485 → 278Canon486 → 279Canon487 → V280+`

## מה נבנה
**`lib/providerAdapters279Canon487.js`** — shim קנוני עבור V279:
- מייצא surface זהה ל-`providerAdapters279.js` (29 contracts)
- מוסיף `getCanonInfo487()` בלבד
- `V280` עודכן לייבא מה-shim (לא מ-279 ישירות)

## אימות
- SACRED ✅ | server parse-clean ✅ | **10/10** ✅
