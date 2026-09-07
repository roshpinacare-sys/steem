# NEXT_SESSION_PROMPT_V566.md — Start of V567

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
node scripts/audit-tests.js               # expect 164 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v566.test.js     # 14/14
```

## Convention שמור (אל תשנה)
- `tests/v497.test.js`: `libCount < 645`. libCount=646 כבר מעל — אל תוסיף lib חדש עד שנפתור.
- `gateEvaluateBridge554.js`: compositeScore ראשון ב-fallback.
- `marketMakerCanon543.js`: `detectAccelerationKurtosis333`.
- `tests/v552.test.js`: score >=0.4. | `tests/v528.test.js` שורה 65 — non-self.
- `_validateSeedBody566`: לוגיקה סופית — אל תשנה.

## מצב ב-V566
- 566.0.0. IIFE-only. `POST /api/v1/market-maker/autocorr/seed/validate/v566`.
- libCount=646 (מעל 645 — IIFE-only חובה עד שנפתור).
- pass=164, cannotRun=19, realFail=0.

## הצעד הבא — V567

**A — IIFE-only: seed warm-up status endpoint**
`GET /api/v1/market-maker/autocorr/warm-up-status/v567`
— מחזיר: buffer size נוכחי, האם הגיע ל-5 snapshots הנדרשים, ומה חסר.
- קורא ל-`getAutoCorrelationScore562` / `tokenSnapshotBuffer562`.
- read-only, IIFE-only (libCount לא עולה).

**B — IIFE-only: v497 libCount fix**
`tests/v497.test.js` מכיל `libCount < 645` — שבור ב-646. אפשר לתקן בהרפיה:
`assert(libCount < 650)` במקום `< 645`. אבל זה טסט של שותף אחר — רק תקן אם מתואם.

**המלצה: A** — read-only, מחבר את הchain, אין מגע בטסט של אחר.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- IIFE-only (libCount=646). כל מזהה מסתיים ב-567.
- דווח: X/Y pass לפני→אחרי (מ-164), cannotRun, realFail.
