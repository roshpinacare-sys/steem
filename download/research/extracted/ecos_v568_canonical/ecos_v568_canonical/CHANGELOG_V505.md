# CHANGELOG V505

## זוהה
- **באג ב-`systemStatus504.js`**: `_loadGovernanceState504` קרא `fn(null)` — שזרק
  `"orchestrator (V437) required"` כי `ctx=null`. כתוצאה, `governance.ok = false`
  בכל קריאה ל-`GET /api/v1/status`.
- בעיה שניה: `getter()` הוא async Promise — לא ניתן לקרוא ב-sync context.

## מה נבנה
- **`lib/systemStatus505.js`** + **`src/lib/`** (mirror):
  - `_loadGovernanceState505` תוקן עם שני נתיבים:
    - **Path 1** (מועדף): קורא ישירות ל-`diamondGovernanceCycle499.runGovernanceCycle499()` — synchronous, ללא צורך ב-orchestrator
    - **Path 2** (fallback): מספק orchestrator stub מינימלי (fail-closed, dryRun), מטפל ב-async Promise
  - `governance.ok` עבר מ-`false` ל-`true`
- **IIFE V505** בשרת:
  - `GET /api/v1/status/v505` — posture עם governance תקין
  - `GET /api/v1/admin/summary/v505`

## אימות
- `node --check ecos-api-server.js` → OK
- SACRED md5: fiatLedger ✓ auditLog ✓
- `NODE_ENV=test node tests/v505.test.js` → **10/10 exit 0**
- `node scripts/audit-tests.js` → **51/123 pass, 72 cannotRun, 0 realFail** (50→51 עלייה)

## מה לא אומת
- 72 cannotRun — טסטים של vitest/ESM שאינם ניתנים לריצה ב-Node.js ישיר. לא נחשבים כשל.
- governance healthScore = null כי gc499 מחזיר cognition שלא תמיד כולל healthScore.
- async path (Path 2) לא נבדק בפועל (Path 1 מצליח תמיד).
