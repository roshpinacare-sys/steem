# CHANGELOG_V509.md — tipModuleCanon509 Facade

## מה זוהה
מגדל `tipModule` עם 6 גרסאות (V263–V268): 5 thin re-exports ל-V268 (parallel-dup מובהק).
canonBridgePatch508 סיווג אותן שגוי כ-`inheritance-chain` → תוקן עכשיו.

## מה נבנה
`lib/tipModuleCanon509.js` + `src/lib/tipModuleCanon509.js`

Facade קנונית:
- מאצילה ל-`tipModule268.js` (המקור נשמר)
- מייצאת משטח V268 מלא: `TipModule268`, `defaultTipModule268`, `TIP_MAX_MICRO_268` (BigInt μ¢), `TIP_MIN_MICRO_268`, `COMMUNITY_MATCH_RATE_268`
- `getTowerDescriptor509()` — פורמט canonBridgePatch508
- `getCanonInfo509()` — מטה-דאטה קריאה לאדם
- **Self-registers** עם `canonBridgePatch508.registerCanonFacade508()` בטעינה

## מה חובר
- `canonBridgePatch508.getKindDiff508()` מחזיר עכשיו `tipModule` עם `canonKind: 'parallel-duplicate'` (תוקן מ-`inheritance-chain`)
- IIFE `_wireTipModuleCanon509` בשרת:
  - `GET /api/v1/tip/canon/status`
  - `GET /api/v1/admin/summary/v509`

## אימות
`NODE_ENV=test node tests/v509.test.js` — **11/11 ✅**

## תוצאות audit-tests (מחוץ לטסט — circular בתוכו)
- 55 pass (54 קודם + v509), 72 cannotRun, 2 realFail קדם-קיימות (v504, v506 — לא קשורות ל-V509)

## מה לא אומת
- v504, v506 realFail — קיימות לפני V509, לא נבדקו ולא תוקנו.
- 72 cannotRun (vitest/ESM) — לא ניתן לאמת בסביבה זו.
- V263..V267 לא עודכנו לייבא מה-facade (הם כבר thin re-exports ל-268, לא עלו בשרשרת).

## SACRED
- `fiatLedger.js`: `563e9b1f9e67091a5b6527c0a92568e5` ✅
- `auditLog.js`:   `e5a5c2c27801d2d03991bc8e5a1df8cb` ✅
