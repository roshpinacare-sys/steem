# CHANGELOG V506 — Wire /api/v1/status → systemStatus505

**Phase:** P250 | **Version:** 506.0.0 | **Date:** 2026-06-05

## מה זוהה
- `GET /api/v1/status` עדיין קרא ל-`systemStatus504` (governance.ok=false — באג V504).
- `systemStatus505` תיקן את הבאג אך לא חובר ל-endpoint הראשי.
- אי-התאמה: `/api/v1/status/v505` עבד תקין, `/api/v1/status` — לא.

## מה נבנה
**IIFE V506** ב-`ecos-api-server.js`:
- **In-place handler replacement**: מחפש `GET /api/v1/status` ב-`_appRoutes[]` ומחליף את ה-fn ל-handler שקורא `status505.getSystemPosture505()`.
- **Backwards-compat alias**: `status504.getSystemPosture504` ← delegate ל-`status505.getSystemPosture505` (קוד ישן לא נשבר).
- **`GET /api/v1/admin/summary/v506`**: סיכום + אישור `routeReplaced=true`.

## מה חובר
`systemStatus505` ↔ `GET /api/v1/status` — הקצה הראשי מחזיר עכשיו `governance.ok=true`.

## אימות
- ✅ SACRED: `563e9b1f` / `e5a5c2c2`
- ✅ `node --check` clean (38,113 שורות)
- ✅ `tests/v506.test.js`: **16/16 passed**
- ✅ `tests/v505.test.js`: **10/10 passed** (ריפוי strictEqual→parseInt>=505)

## מה לא אומת
- 72 cannotRun (vitest/ESM) — לא ניתנים לאימות בסביבה זו, לא נחשבים ככשל.
- ה-endpoint בפועל לא נבדק ב-HTTP (אין שרת חי בסביבת הבנייה).
