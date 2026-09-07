# NEXT_SESSION_PROMPT_V560.md — Start of V561

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js
node --check ecos-api-server.js
node scripts/audit-tests.js   # 158 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v560.test.js   # 12/12
```

## Convention שמור
- `tests/v497.test.js`: `libCount < 645`. לא להוסיף lib modules ללא עדכון threshold.
- selfExcludes: v510, v528, v534 — circular audit loop.
- V557 IIFE: `U558_557` soft-require. fallback ל-V556 נשמר. אל תמחק fallback.
- `gateEvaluateBridge554.js`: compositeScore ראשון בfallback chain. אל תשנה סדר.

## מצב ב-V560
- 560.0.0. gateScore אמיתי: 0.5 (תוקן מ-field mismatch). gateDecision=MANUAL (threshold ≥0.70).
- 158 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V561

**gateDecision עדיין MANUAL** — כי compositeScore=0.5 < threshold 0.70.
בדוק מה גורם לציונים הנמוכים:
```bash
node -e "const C=require('./lib/marketMakerCanon543.js'); console.log(JSON.stringify(C.getCompositeScore543(),null,2));"
```
- `autocorr: 0` כי `bandWidthAutocorr: null` — אין נתונים.
- `kurtosis: 0` — צריך להבין למה.

V561: בדוק אם `buildDeepHealth539` מוזן בנתונים אמיתיים, או אם צריך warm-up.
אלטרנטיבה: endpoint שמדמה warm-up / seed data ל-`RankedOverlapBuffer333`.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-561. tests/v561.test.js exit 0 → zip.
- דווח: pass לפני→אחרי, cannotRun, realFail.
