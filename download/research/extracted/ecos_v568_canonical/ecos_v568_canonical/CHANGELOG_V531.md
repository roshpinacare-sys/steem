# CHANGELOG V531 — Governance × Status Bridge 🔗

**Phase:** P259 | **Version:** 531.0.0 | **Date:** 2026-06-05

## מה זוהה
- `systemStatus505` ו-`diamondGovernanceCycle499` פועלים בבידוד — ללא חיבור.
- `/api/v1/status` מחזיר posture תפעולי בלבד; `/api/v1/diamond/governance-cycle` פועל
  בנפרד. אין endpoint אחד שמשלב את שניהם.
- Loop רגרסיה ישנה: `v510.test.js` ↔ `v528.test.js` מפנים זה לזה ב-TEST_AUDIT (circular fail).

## מה נבנה

### `src/lib/governanceStatusBridge531.js` (+ mirror `lib/`)
- `buildBridgeSnapshot531(opts)` — מחבר `systemStatus505.getSystemPosture505()` עם
  `diamondGovernanceCycle499.runGovernanceCycle499()` לסנאפשוט מאוחד.
- תמיד propose-only (`authorized=false, dryRun=true`).
- Fail-safe: אם אחד המקורות נכשל — מחזיר `ok=false` + `errors[]` ללא throw.
- Signal מאוחד: YELLOW אם יש שגיאות; RED אם posture=critical.

### IIFE V531 בשרת
- **`GET /api/v1/status/governance`** (V531-T01): סנאפשוט מאוחד — posture + governance proposals.
- **`GET /api/v1/admin/summary/v531`** (V531-T02): מטה-דיווח.

### תיקוני רגרסיה
- `tests/v530.test.js` שורה 47: `strictEqual('530.0.0')` → `parseInt>=530`.
- `tests/v528.test.js` שורה 65: `strictEqual(realFail,0)` → non-self filter (שובר circular loop עם v510).

## מה חובר
`systemStatus505` ↔ `diamondGovernanceCycle499` (דרך `moduleOrchestrator437`) → endpoint אחד.

## אימות (מספרים בלבד)
| | לפני | אחרי |
|---|---|---|
| pass | 128 | **129** |
| cannotRun | 19 | 19 |
| realFail | 0 | **0** |
| v531.test.js | — | **24/24** |

## מה לא אומת
- 19 cannotRun (vitest/ESM) — לא ניתן לאמת בסביבה זו.
- `/api/v1/status/governance` לא נבדק ב-HTTP חי (אין שרת רץ בבנייה).
