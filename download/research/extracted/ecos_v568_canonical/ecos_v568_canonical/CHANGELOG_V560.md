# CHANGELOG V560 — compositeScore Field Fix

## תאריך
2026-06-05

## מה זוהה
**Bug**: `gateEvaluateBridge554` קרא `sr.composite` ו-`sr.score` כ-fallback מ-`getCompositeScore543`.
אך `getCompositeScore543` מחזיר `{ compositeScore: 0.5, ... }` — לא `composite` ולא `score`.
תוצאה: `gateScore` תמיד היה 0, ו-`gateDecision` תמיד MANUAL.

## מה תוקן
**`lib/gateEvaluateBridge554.js`** (+ `src/lib/`):
- שורה 56: הוסף `sr.compositeScore` כ-fallback ראשון לפני `sr.composite`
- `gateScore` עלה מ-0 → **0.5** (ערך אמיתי מ-`getCompositeScore543`)

## מה חובר
- `GET /api/v1/deep-health/gate-score/v560` — מחזיר gateScore אמיתי + unified.gateScore
- `GET /api/v1/admin/summary/v560`

## אימות
- `tests/v560.test.js` → **12/12 ✓**
- `scripts/audit-tests.js` → **pass=158 (+1), cannotRun=19, realFail=0** (לפני: 157/19/0)
- v554+v556+v557 — **0 רגרסיות**
- SACRED md5: intact | node --check: OK

## מה לא אומת
- 19 suites cannotRun (vitest/ESM).
- `gateDecision` עדיין MANUAL ב-0.5 (threshold ב-554 דורש ≥0.70 ל-PASS). זה expected behavior.
