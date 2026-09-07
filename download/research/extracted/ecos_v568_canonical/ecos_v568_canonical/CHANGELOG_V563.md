# CHANGELOG V563 — Enhanced Composite Score (autocorr connected to V562 buffer)

## תאריך
2026-06-06

## מה זוהה
- V562 הוסיף ring buffer (`tokenSnapshotBuffer562`) אבל לא חיבר אותו ל-`getCompositeScore543`
- `getCompositeScore543` עדיין קורא `measureBandWidthAutocorrelation333([], ...)` → autocorr=0 תמיד
- baseline: pass=160, cannotRun=19, realFail=0

## מה נבנה
- **`lib/marketMakerCompositeEnhanced563.js`** + `src/lib/`
  - `getCompositeScore563()` — compositeScore עם autocorr אמיתי:
    - kurtosis, outlierZ, entropy: מ-`getCompositeScore543()` (unchanged)
    - autocorr: מ-`getAutoCorrelationScore562(rb)` עם buffer אמיתי
  - empty buffer: compositeScore = 0.8 (backward-compatible עם V543)
  - seeded buffer (≥5 snapshots): compositeScore = 1.0, grade A+
  - שדות: `v543baseline`, `improvement`, `autocorrSource`, `details.autocorr.hint`
  - `registerEndpoints563(app)` — wire endpoint

## מה חובר
- Chain: `POST /autocorr/seed/v562` → `tokenSnapshotBuffer562` → `getCompositeScore563` → 1.0
- `GET /api/v1/market-maker/composite/live/v563`
- `GET /api/v1/admin/summary/v563`

## אימות
- `tests/v563.test.js` → **12/12** (exit 0)
- `audit-tests.js` → **pass=161 (+1), cannotRun=19, realFail=0** — 0 regressions
- SACRED md5: intact

## מה לא אומת
- 19 suites cannotRun (vitest/ESM)
- Buffer state בין restarts לא persistent — seed נדרש לאחר כל restart
- `/composite/v543` endpoint עצמו לא שונה (עדיין 0.8)
