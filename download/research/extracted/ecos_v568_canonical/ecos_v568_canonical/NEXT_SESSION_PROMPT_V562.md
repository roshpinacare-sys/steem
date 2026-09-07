# NEXT_SESSION_PROMPT_V562.md — Start of V563

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
node scripts/audit-tests.js               # expect 160 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v562.test.js     # 12/12
```

## Convention שמור
- `tests/v497.test.js`: `libCount < 650`. ב-V562 יש ~N lib files — בדוק.
- `gateEvaluateBridge554.js`: compositeScore ראשון ב-fallback. אל תשנה.
- `marketMakerCanon543.js`: `detectAccelerationKurtosis333` — אל תחזיר לשם הישן.
- `tests/v552.test.js`: score assertion >=0.4. אל תחמיר.

## מצב ב-V562
- 562.0.0. `tokenSnapshotBuffer562` — ring buffer ל-autocorr warm-up.
  Fix: `measureBandWidthAutocorrelation333` עם `[]` תמיד → ok:false → autocorr=0.
  Endpoint seed + score נפרד. getCompositeScore543 לא שונה עדיין.
- pass=160, cannotRun=19, realFail=0.

## הצעד הבא: V563

**חבר tokenSnapshotBuffer562 ל-getCompositeScore543 ישירות:**

`getCompositeScore543` קורא `measureBandWidthAutocorrelation333([], ...)` hardcoded.
בנה `getCompositeScore563(opts)` חדש בתוך `marketMakerCanon543Enhanced563.js`:
- מייבא את `tokenSnapshotBuffer562`
- קורא `getAutoCorrelationScore562(rb)` במקום `measureBandWidthAutocorrelation333([], ...)`
- חשב compositeScore אמיתי (יכול להגיע ל-1.0 אחרי warm-up)

אפשרות בטוחה יותר: endpoint `GET /api/v1/market-maker/composite/live/v563` שמשתמש ב-V562 buffer.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-563. IIFE בסוף. tests/v563.test.js exit 0.
- דווח: pass לפני→אחרי, cannotRun, realFail.
