# CHANGELOG_V556.md — gatePolicyTrendBridge556

## מה זוהה
NEXT_SESSION_PROMPT_V555: אחרי תיקון V555, `policy546.getPolicy546()` הפך למקור-אמת אמין לtrend.
כרגע `GET /gate/evaluate` (V554) מחזיר trend מ-gate בלבד. אין השוואה עם policy — אין יכולת לזהות אי-הסכמה.

## מה נבנה
`lib/gatePolicyTrendBridge556.js` (+ `src/lib/`):

שתי פונקציות:
- **`enrichWithPolicyTrend556(gateResult, policyResult)`** — מוסיף `policyTrend`, `policyDecision`, `trendAgreement` (true/false/null), `trendSources`, `enrichedBy`
- **`buildEnrichedEval556({evalFn554, policyFn546})`** — קורא לשני המקורות, soft-fails על שגיאות

לוגיקת `trendAgreement`:
- `true` — שניהם מסכימים, אין חשש
- `false` — אי-הסכמה → 207 status
- `null` — לא ניתן להשוות (אחד מהם 'unknown')

## מה חובר
IIFE `_wireGatePolicyTrendBridge556`:
- `GET /api/v1/deep-health/gate/evaluate/v556` — V554 + policy546 ביחד
- `GET /api/v1/admin/summary/v556`

## SACRED
- `fiatLedger.js`: `563e9b1f9e67091a5b6527c0a92568e5` ✅
- `auditLog.js`:   `e5a5c2c27801d2d03991bc8e5a1df8cb` ✅

## אימות
- `NODE_ENV=test node tests/v556.test.js`: **12/12 ✅**
- `node scripts/audit-tests.js` לפני→אחרי: **153→154 pass, 19 cannotRun, 0 realFail** ✅

## מה לא אומת
- 19 cannotRun (vitest/ESM)
- `trendAgreement` עם data אמיתי (לא seed) — לא ניתן לבדוק בסביבת test
