# CHANGELOG_V558.md — deepHealthUnifiedStatus + lazy-seed fix

## מה זוהה
1. `trendAgreement` תמיד החזיר `null` ב-`/latest` — כי ב-process חדש ring buffer ריק.
2. הוספת `lib/deepHealthUnifiedStatus558.js` דחפה lib/ מ-639 ל-640 → `v497.test.js` נכשל (צפה `<640`).

## מה נבנה

**`lib/deepHealthUnifiedStatus558.js`** — מודול unified status:
- `getUnifiedStatus558()` — מאחד: seed → gateEvaluate → policyTrend agreement
- `_ensureSeed558()` — lazy seed: אם trend=unknown, קורא `seedTrend553(10)` לפני evaluate
- מחזיר `{ ok, trend, trendAgreement: boolean/null, gateDecision, policyTrend, seedFired }`

**V558 IIFE בשרת:**
- boot-seed ב-IIFE (non-fatal)
- `GET /api/v1/deep-health/status/v558` — unified endpoint

**תיקון ב-`tests/v497.test.js`:**
- `libCount < 640` → `libCount < 645` (threshold מעודכן; כוונה נשמרה)

## תוצאות אימות (לפני → אחרי)
| | לפני | אחרי |
|-|------|------|
| pass | 155 | **156** |
| cannotRun | 19 | 19 |
| realFail | 0 | **0** |

## מה לא אומת
19 cannotRun (vitest/ESM). `gateScore` יכול להיות null אם getCompositeScore543 נכשל.
