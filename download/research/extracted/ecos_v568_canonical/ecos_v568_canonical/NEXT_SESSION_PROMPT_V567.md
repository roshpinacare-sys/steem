# NEXT_SESSION_PROMPT_V567.md — Start of V568

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js    # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
node scripts/audit-tests.js                 # expect 165 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v567.test.js       # 21/21
ls lib/ | wc -l                             # expect 646
```

## Convention שמור
- `tests/v497.test.js`: `libCount < 645` — כבר שבור ב-646. IIFE-only עד שיתוקן.
- `gateEvaluateBridge554.js`: compositeScore ראשון ב-fallback.
- `marketMakerCanon543.js`: `detectAccelerationKurtosis333`.
- `tests/v552.test.js`: score >=0.4. | `tests/v528.test.js` שורה 65 — non-self.
- `_validateSeedBody566`: לוגיקה סופית — אל תשנה.
- `tokenSnapshotBuffer562.pushTokenSnapshot562(arr)`: מקבל `string[]` בלבד.

## מצב ב-V567
- 567.0.0. IIFE warm-up status חי.
- `GET /api/v1/market-maker/autocorr/warm-up-status/v567`: warmedUp/bufferSize/remaining/fillPercent.
- libCount=646 (IIFE-only constraint פעיל).
- audit: **165 pass, 19 cannotRun, 0 realFail**.

## הצעד הבא — V568

**A — IIFE-only: AutoCorr Seed Batch endpoint**
`POST /api/v1/market-maker/autocorr/seed/batch/v568` — קבלת `{ batches: [string[], ...] }`,
מריץ `pushTokenSnapshot562` על כל batch. מחזיר כמה הצליחו, כמה נכשלו, bufferSize הסופי.
- מאיץ warm-up בקריאה אחת.
- IIFE-only, read/write על buffer קיים.

**B — libCount fix: align v497.test.js**
`assert(libCount < 650)` במקום `< 645` — אבל זה טסט של שותף אחר. תיאום נדרש.

**המלצה: A** — מחבר את warm-up status (V567) עם batch seeding, ללא lib חדש.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- IIFE-only (libCount=646). כל מזהה מסתיים ב-568.
- דווח: X/Y pass לפני→אחרי (מ-165), cannotRun, realFail. חובה "מה לא אומת".
