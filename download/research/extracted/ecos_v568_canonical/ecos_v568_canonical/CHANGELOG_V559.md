# CHANGELOG_V559.md — /latest upgrade to V558 unified

## מה זוהה
V557's `/latest` נתב ל-V556 (`buildEnrichedEval556`) שעלול להחזיר `trendAgreement: null`
כש-ring buffer ריק. V558 פתרה את ה-null עם lazy-seed, אבל `/latest` לא הופנה אליה.

## מה שונה

**V557 IIFE — שינוי in-place:**
- נוספה טעינה של `deepHealthUnifiedStatus558.js` ב-IIFE
- handler של `/latest` משתמש ב-`getUnifiedStatus558()` — `trendAgreement` מובטח boolean
- fallback ל-V556 נשמר (אם unified לא זמין)
- `routedTo: 'v558-unified'` (במקום `'v556'`)

**V559 IIFE חדש (wiring-only — אין lib module חדש):**
- `GET /api/v1/deep-health/gate/evaluate/latest/v559` — canonical V559 endpoint
- `GET /api/v1/admin/summary/v559`

## תוצאות אימות (לפני → אחרי)
| | לפני | אחרי |
|-|------|------|
| pass | 156 | **157** |
| cannotRun | 19 | 19 |
| realFail | 0 | **0** |

## מה לא אומת
19 cannotRun (vitest/ESM). `trendAgreement: false` (מחלוקת gate/policy) לא נבדק end-to-end.
