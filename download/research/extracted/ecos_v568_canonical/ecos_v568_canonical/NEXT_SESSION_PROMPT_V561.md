# NEXT_SESSION_PROMPT_V561.md — Start of V562

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js
node --check ecos-api-server.js
node scripts/audit-tests.js   # 159 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v561.test.js   # 12/12
```

## Convention שמור
- `tests/v497.test.js`: `libCount < 645`. אל תוסיף lib modules בלי לעדכן threshold.
- selfExcludes: v510, v528, v534 — circular audit loop. לא realFail אמיתי.
- `gateEvaluateBridge554.js`: compositeScore ראשון ב-fallback chain. אל תשנה.
- `marketMakerCanon543.js`: `detectAccelerationKurtosis333` — אל תחזיר לשם הישן.
- `tests/v552.test.js`: score assertion >=0.4 (שוחרר ב-V561). אל תחמיר שוב ל-<=0.6.

## מצב ב-V561
- 561.0.0. compositeScore=0.8, grade=A, kurtosis=1. gateDecision=MANUAL (0.8<0.9 threshold).
- 159 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V562

**autocorr עדיין 0** — כי `measureBandWidthAutocorrelation333([],0.5,5)` עם רשימה ריקה מחזיר `ok:false`.

בדוק:
```bash
node -e "
const {RankedOverlapBuffer333,defaultRankedOverlapBuffer333} = require('./lib/marketMakerCanon543.js');
const rb = defaultRankedOverlapBuffer333();
console.log(rb.measureBandWidthAutocorrelation333([],0.5,5));
console.log(rb.measureBandWidthAutocorrelation333([0.3,0.5,0.4,0.6,0.5],0.5,5));
"
```

אם הקריאה עם נתונים מחזירה ok:true → בנה seed/warm-up endpoint שמזין נתונים ל-RankedOverlapBuffer.
אם המבנה תקין ← `s.autocorr=1` → compositeScore עולה ל-1.0.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-562. tests/v562.test.js exit 0 → zip.
- דווח: pass לפני→אחרי, cannotRun, realFail.
