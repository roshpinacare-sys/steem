# NEXT_SESSION_PROMPT_V564.md — Start of V565

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
node scripts/audit-tests.js               # expect 162 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v564.test.js     # 13/13
```

## Convention שמור (אל תשנה)
- `tests/v497.test.js`: `libCount < 645`. libCount=644 — נשארה רק 1 מקום. לפני מודול חדש: בדוק!
- `gateEvaluateBridge554.js`: compositeScore ראשון ב-fallback. אל תשנה.
- `marketMakerCanon543.js`: `detectAccelerationKurtosis333` — אל תחזיר לשם הישן.
- `tests/v552.test.js`: score assertion >=0.4. אל תחמיר.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.

## מצב ב-V564
- 564.0.0. `gateLiveEvaluate564.js` — live gate עם V563 score.
- Chain: POST /autocorr/seed/v562 → getCompositeScore563 → evaluateLiveGate564 → decision.
- `GET /api/v1/gate/evaluate/diff/v564` — diff baseline (V554) vs live (V564).
- pass=162, cannotRun=19, realFail=0. libCount=644 (מקסימום 644).

## ⚠️ קריטי: libCount=644, limit=645
אם V565 מוסיף מודול ל-lib/ → libCount=645 → test v497 ייכשל!
אפשרויות:
1. **נקה מודול אחד מ-lib/** לפני הוספה — ודא 0 הפניות ב-require ובטסטים.
2. **אל תוסיף קובץ ל-lib/** — השתמש במודול קיים או בנה endpoint ב-IIFE בלבד.

## הצעד הבא: V565

**אפשרות A — expose trend בריא (ללא מודול חדש)**
`deepHealthAlertHistory542` מחזיר `getTrend542()` עם `direction` — אבל direction=unknown תמיד.
בדוק אם יש data בהיסטוריה: `node -e "const h=require('./lib/deepHealthAlertHistory542.js'); console.log(h.getHistory542 && h.getHistory542())"`
אם ריק — לא כדאי לטפל.

**אפשרות B — summary endpoint V565 שמקשר כל הchain**
IIFE בלבד (ללא קובץ lib חדש!):
`GET /api/v1/gate/chain-summary/v565` — מחזיר ב-response אחת:
```json
{
  "scoreV543": 0.8, "scoreV563": 0.8, "delta": 0,
  "gateV554": "MANUAL", "gateLiveV564": "MANUAL",
  "autocorrBufferSize": 0, "hint": "seed via POST /autocorr/seed/v562"
}
```
ללא קובץ lib חדש → libCount נשאר 644 ✓

**המלצה: B** — ללא קובץ חדש, observability מלא על הchain.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזידה מסתיים ב-565. IIFE בסוף. tests/v565.test.js exit 0.
- דווח: pass לפני→אחרי (מ-162), cannotRun, realFail. ודא libCount<645.
