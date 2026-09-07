# CHANGELOG V562 — Token-Snapshot Buffer for Autocorr Warm-up

## תאריך
2026-06-06

## מה זוהה
- **שורש הבעיה**: `getCompositeScore543()` שורה 91:
  `_rb543.measureBandWidthAutocorrelation333([], 0.5, 5)` — `[]` **תמיד ריק** hardcoded
  → `ok:false` תמיד → `autocorr=0` → compositeScore מוגבל ל-0.8 (לא 1.0)
- `measureBandWidthAutocorrelation333` מצפה ל-`string[][]` (רשימות ranked tokens)
- עם נתונים אמיתיים (≥5 snapshots): `ok:true`, score=1
- baseline: pass=159, cannotRun=19, realFail=0

## מה נבנה
- **`lib/tokenSnapshotBuffer562.js`** + `src/lib/tokenSnapshotBuffer562.js`
  - Ring buffer עם קיבולת 20 snapshots (string[][])
  - `pushTokenSnapshot562(tokenList)` — הוסף ranked token list
  - `getAutoCorrelationScore562(rb)` — חשב autocorr עם הנתונים האמיתיים
  - `clearTokenSnapshots562()` — לטסטים
  - `registerEndpoints562(app, rb)` — wire endpoints
- IIFE V562 — הוספה בלבד, אין שינוי ב-getCompositeScore543

## מה חובר
- `POST /api/v1/market-maker/autocorr/seed/v562` — seed token snapshots
- `GET  /api/v1/market-maker/autocorr/score/v562` — autocorr score עם נתונים אמיתיים
- `GET  /api/v1/admin/summary/v562`

## אימות
- `tests/v562.test.js` → **12/12** (exit 0)
- `audit-tests.js` → **pass=160 (+1), cannotRun=19, realFail=0** — 0 regressions
- SACRED md5: intact

## מה לא אומת
- 19 suites cannotRun (vitest/ESM)
- `getCompositeScore543()` עצמו **לא שונה** — הוא עדיין קורא עם `[]`. V562 מספק endpoint נפרד עם הנתונים הנכונים.
- Scheduler לא מוגדר (seed ידני בלבד)
