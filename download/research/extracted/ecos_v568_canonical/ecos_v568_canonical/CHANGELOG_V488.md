# CHANGELOG V488 — providerAdapters280 Canon Shim

## תאריך
2026-06-05

## מה זוהה
V281 ייבא `providerAdapters280` ישירות (לא דרך shim). ממשיך את שרשרת ה-Canon.

## מה נבנה
- **`lib/providerAdapters280Canon488.js`** (+ `src/lib/`)
  - shim קנוני זהה לדפוס 279Canon487
  - `getCanonInfo488()`: version, prevShim, contractCount=30, contracts[]

## מה חובר
- `lib/providerAdapters281.js` מעודכן: `require('./providerAdapters280Canon488.js')`
- שרשרת שלמה: 275Canon483→276Canon484→277Canon485→278Canon486→279Canon487→**280Canon488**

## אימות
- `node --check` → OK | SACRED → intact | `tests/v488.test.js` → **10/10 ✓**
