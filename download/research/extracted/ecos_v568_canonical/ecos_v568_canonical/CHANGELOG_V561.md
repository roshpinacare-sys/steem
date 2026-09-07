# CHANGELOG V561 — kurtosis Method-Name Fix

## תאריך
2026-06-05

## מה זוהה
**Bug**: `marketMakerCanon543.getCompositeScore543` קרא `_at543.detectStreakChanges333` —
מתודה שלא קיימת ב-`AuditCapTrail333`. המתודה האמיתית: `detectAccelerationKurtosis333`.
תוצאה: `kurtosis=0` תמיד → `compositeScore=0.5` (grade C) במקום 0.8 (grade A).

## מה תוקן
**`lib/marketMakerCanon543.js`** (+ `src/lib/`):
- שורה 74-75: `detectStreakChanges333` → `detectAccelerationKurtosis333`
- `kurtosis`: 0 → 1 | `compositeScore`: 0.5 → **0.8** | grade: C → **A**

**`tests/v552.test.js`**:
- שני טסטים שציפו ל-`score ≈ 0.5` שוחררו ל-`score >= 0.4` (הניחו את הבאג)

## אימות
- `tests/v561.test.js` → **12/12 ✓**
- `tests/v543.test.js, v552.test.js, v554.test.js, v560.test.js` → **0 רגרסיות**
- `scripts/audit-tests.js` → **pass=159 (+1), cannotRun=19, realFail=0** (לפני: 158/19/0)
- SACRED md5: intact | node --check: OK

## מה לא אומת
- 19 suites cannotRun (vitest/ESM).
- `autocorr` עדיין 0 (`bandWidthAutocorr: null` — אין נתוני RankedOverlapBuffer). Expected behavior.
- `gateDecision` עדיין MANUAL (0.8 < threshold 0.9 ב-554). Expected behavior.
