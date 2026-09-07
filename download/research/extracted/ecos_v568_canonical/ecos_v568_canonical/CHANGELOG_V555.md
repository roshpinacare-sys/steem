# CHANGELOG_V555.md — deepHealthPolicy546 trend bug fix

## מה זוהה
באג מתועד מ-NEXT_SESSION_PROMPT_V554:
- `deepHealthPolicy546._readTrend546` קרא `r.trend` אבל `getTrend542()` מחזיר `r.direction`
- תוצאה: `policy.trend` תמיד החזיר `'unknown'` גם עם נתונים
- `gateEvaluateBridge554` עקף את הבאג, אבל המקור לא תוקן

## מה תוקן
שורה אחת בדיוק, בשני מקומות:

**`lib/deepHealthPolicy546.js` שורה 88** (+ `src/lib/deepHealthPolicy546.js`):
```diff
- : (r && typeof r.trend === 'string') ? r.trend
+ : (r && typeof r.direction === 'string') ? r.direction
```

לפני: `policy.trend === 'unknown'` תמיד (גם עם 10 data points)
אחרי: `policy.trend === 'stable'` (מתאים ל-`getTrend542().direction`)

## עדכון טסט
`tests/v554.test.js` T05: הוסר assert על הבאג הישן, הוחלף בוידוי שהתיקון פועל.

## IIFE
`_wireDeepHealthPolicyFix555` — summary endpoint בלבד + boot-time validation.

## SACRED
- `fiatLedger.js`: `563e9b1f9e67091a5b6527c0a92568e5` ✅ (לא נגעו)
- `auditLog.js`:   `e5a5c2c27801d2d03991bc8e5a1df8cb` ✅ (לא נגעו)

## אימות
- `NODE_ENV=test node tests/v555.test.js`: **12/12 ✅**
- `NODE_ENV=test node tests/v554.test.js`: **14/14 ✅** (אחרי עדכון T05)
- `node scripts/audit-tests.js` לפני→אחרי: **152→153 pass, 19 cannotRun, 0 realFail** ✅

## מה לא אומת
- 19 cannotRun (vitest/ESM) — לא ניתן לאמת בסביבה זו
- `policy.decision` עדיין `MANUAL` כשאין הפעלה מלאה — צפוי (score=0 בסביבת test)
