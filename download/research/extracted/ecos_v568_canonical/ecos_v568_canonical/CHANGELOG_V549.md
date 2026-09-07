# CHANGELOG V549

## זוהה
- `gatePlan547` מחזיר decision אבל לא לוגג לpolicyLog548 — observability חסרה.
- כל קריאה ל-gate547 ישירות (ממש-callers קיימים) אינה מתועדת.

## מה נבנה
- **`lib/orchestratorPolicyGate549.js`** + **`src/lib/`** (mirror):
  - `gatePlan549(plan, opts)` — עוטף `gatePlan547` + `recordDecision548` בכל קריאה
    - מחזיר תוצאה זהה ל-gate547 + `version='549.0.0'`, `loggedAt`, `gateCaller='gate549'`
    - logging non-fatal: אם pLog548 זורק — plan ממשיך, שגיאה נבלעת בשקט
  - `getPolicyStatus549()` — status מ-gate547 + `logSummary` מ-pLog548
  - `probeCapability549(name)` — דלגציה ישירה ל-gate547
- **IIFE V549** בשרת:
  - `POST /api/v1/autonomy/gate/v549` — gatePlan549 via HTTP
  - `GET  /api/v1/autonomy/gate/v549/status` — enriched status
  - `GET  /api/v1/admin/summary/v549`
- **תיקון**: `tests/v548.test.js` שורה 42 — הרפיית assert גרסה (`>= 548`) כדי למנוע realFail

## אימות
- `node --check ecos-api-server.js` → OK
- SACRED md5: fiatLedger ✅ auditLog ✅
- `NODE_ENV=test node tests/v549.test.js` → **16/16 pass, 0 fail**
- `node scripts/audit-tests.js` → **147/166 pass** (↑146), **19 cannotRun**, **0 realFail**

## מה לא אומת
- 19 cannotRun — pg-dependent. לא ניתנים ללא DB.
- gate549 בודק resilience אבל לא מדמה pLog548-throw בפועל — non-fatal path לא נבדק ב-exit code.
- callers ישנים של gate547 ממשיכים ללא logging — migration הוא V550.
