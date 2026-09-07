# NEXT_SESSION_PROMPT_V568.md — Start of V569

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js     # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
node scripts/audit-tests.js                  # expect 166 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v568.test.js        # 20/20
ls lib/ | wc -l                              # expect 646
```

## Convention שמור
- `tests/v497.test.js`: `libCount < 645` שבור ב-646. IIFE-only עד תיאום.
- `gateEvaluateBridge554.js`: compositeScore ראשון ב-fallback.
- `marketMakerCanon543.js`: `detectAccelerationKurtosis333`.
- `tests/v552.test.js`: score >=0.4. | `tests/v528.test.js` שורה 65 — non-self.
- `_validateSeedBody566`: לוגיקה סופית — אל תשנה.
- `pushTokenSnapshot562(arr)`: מקבל `string[]` בלבד. all-whitespace → ok=false.

## מצב ב-V568
- 568.0.0. IIFE autocorr batch חי.
- שרשרת autocorr: seed/v562 → batch/v568 → warm-up-status/v567 → score/v562
- libCount=646 (IIFE-only constraint פעיל).
- audit: **166 pass, 19 cannotRun, 0 realFail**.

## הצעד הבא — V569

**A — IIFE-only: autocorr score snapshot**
`GET /api/v1/market-maker/autocorr/score-with-status/v569`
— ממזג warm-up-status (V567) עם score/v562 בתגובה אחת. שימושי לדשבורד: warmedUp + score + autocorr + bufferSize.
- IIFE-only. read-only. 0 state חדש.

**B — libCount fix (תיאום)**
`tests/v497.test.js` שורה עם `libCount < 645` — אם תיאום עם שותפים מתאפשר, שנה ל-`< 650`.
⚠️ אל תשנה ללא תיאום — זה טסט של שותף אחר.

**המלצה: A** — ממשיך את קו autocorr, read-only, IIFE-only, ברור ושמיש.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- IIFE-only (libCount=646). כל מזהה מסתיים ב-569.
- דווח: X/Y pass לפני→אחרי (מ-166), cannotRun, realFail. חובה "מה לא אומת".
