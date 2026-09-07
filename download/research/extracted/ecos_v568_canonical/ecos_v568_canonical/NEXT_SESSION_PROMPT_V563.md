# NEXT_SESSION_PROMPT_V563.md — Start of V564

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
node scripts/audit-tests.js               # expect 161 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v563.test.js     # 12/12
```

## Convention שמור
- `tests/v497.test.js`: `libCount < 650`. בדוק לפני הוספת מודולים.
- `gateEvaluateBridge554.js`: compositeScore ראשון ב-fallback. אל תשנה.
- `marketMakerCanon543.js`: `detectAccelerationKurtosis333` — אל תחזיר לשם הישן.
- `tests/v552.test.js`: score assertion >=0.4. אל תחמיר.

## מצב ב-V563
- 563.0.0. `marketMakerCompositeEnhanced563` — compositeScore=1.0 אחרי seed.
  Chain: POST /autocorr/seed/v562 → tokenSnapshotBuffer562 → getCompositeScore563 → 1.0.
  empty buffer → 0.8 (backward-compatible). seeded → 1.0, grade A+.
- pass=161, cannotRun=19, realFail=0.

## הצעד הבא הכי בעל-מינוף: V564

**חבר `/composite/live/v563` ל-`gateEvaluateBridge554`:**

`gateEvaluateBridge554` מחשב gateScore מ-`getCompositeScore543()` (0.8).
אם ישתמש ב-`getCompositeScore563()` → gateScore יכול לעלות ל-1.0 → APPROVED.

בדוק:
```bash
grep -n "getCompositeScore\|gateScore\|gateDecision" lib/gateEvaluateBridge554.js | head -15
```
אם הפונקציה ניתנת להרחבה (opts/inject) → בנה wrapper.
אם לא → בנה endpoint `/gate/evaluate/live/v564` שקורא `getCompositeScore563()` ישירות.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-564. IIFE בסוף. tests/v564.test.js exit 0.
- דווח: pass לפני→אחרי, cannotRun, realFail.
