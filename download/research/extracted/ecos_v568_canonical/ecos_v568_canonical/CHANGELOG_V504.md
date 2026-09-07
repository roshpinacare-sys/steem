# CHANGELOG V504

## מה זוהה
- **meshDispatcher 288-297 פעילים** (49 הפניות בשרת — inheritance chain שנטענת ב-IIFEs). ארכיון לא אפשרי.
- `GET /api/v1/status` לא היה קיים. Diamond modules קיימים אבל מפוזרים בלי נקודת כניסה למשתמשים.

## מה נבנה / חובר
**`src/lib/systemStatus504.js`** (+ mirror ב-`lib/`):
- מחבר 3 מקורות Diamond:
  - `testStatusReport503` → pass/cannotRun/realFail
  - `diamondCodeHealthSignal498` → debtScore + tower count
  - `heartbeatGovernanceState501` → healthScore + posture
- `getSystemPosture504()` — מחשב signal (GREEN/YELLOW/RED) ומחזיר תמונת מצב מאוחדת
- fail-closed לכל מקור בנפרד — מקור שנפל לא יפיל את שאר המקורות

**V504 IIFE** בשרת:
- `GET /api/v1/status` — system posture; HTTP 503 כאשר signal=RED
- `GET /api/v1/admin/summary/v504`

## תוצאות אימות
- SACRED md5 ✅ (fiatLedger `563e9b...` / auditLog `e5a5c2...`)
- `node --check` ✅
- `tests/v504.test.js` → **12/12, exit 0** ✅
- `scripts/audit-tests.js` → **50/122 pass, 72 cannotRun, 0 realFail** ✅ (היה 49, עלה ל-50)
- גרסה: `504.0.0` ✅

## מה לא אומת
- **72 cannotRun** — vitest/ESM suites, לא ניתן להריץ ב-Node ישיר. לא נבדק ולא נחשב.
- `heartbeatGovernanceState501` מחזיר `ok:false` כשאין heartbeat cycle פעיל — זה כשוי עבודה (fail-closed תקין).
- Diamond heartbeat 454/465 עצמם לא הופעלו ב-test (לא נדרש — הם long-running, רק קוראים state).
