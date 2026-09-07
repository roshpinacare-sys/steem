# CHANGELOG_V474.md — meshDispatcher Canon Facade V474

## מה זוהה
מגדל `meshDispatcher` (V288–V297) כבר קיבל facade ב-V470 (`meshDispatcherCanon470`),
אך ה-facade חסר: (א) health snapshot חי, (ב) dispatch מובנה לכלים.
V474 מרחיב את ה-facade ומוסיף שתי יכולות אלה.

## מה נבנה
**`lib/meshDispatcherCanon474.js`** — facade מעודכן עם:

| פונקציה | תפקיד |
|---------|-------|
| `getCanonInfo474()` | מטה-דטה של הטאואר (כמו canon470, עדכני) |
| `getHealthSummary474()` | snapshot חי: reasonFeed + byValidator + authGate |
| `dispatchCapability474(capId, args)` | dispatch בטוח: `search`, `health`, `info` — fail-closed על לא-ידוע |

## מה חובר
- `D297` surface מיוצא מחדש כך שקוד חדש לא צריך לגעת ב-D288..D296
- סינגלטוני D297 מנויים ל-`global.__ECOS_V296_STREAM__` (non-fatal)

## Endpoints
- `V474-T01 GET  /api/v1/mesh/dispatcher/canon/status`
- `V474-T02 POST /api/v1/mesh/dispatcher/dispatch/v474`
- `V474-T03 GET  /api/v1/admin/summary/v474`

## SACRED
- `fiatLedger.js`: `563e9b1f9e67091a5b6527c0a92568e5` ✅
- `auditLog.js`:   `e5a5c2c27801d2d03991bc8e5a1df8cb` ✅

## טסטים
`NODE_ENV=test node tests/v474.test.js` — **10/10 ✅**
