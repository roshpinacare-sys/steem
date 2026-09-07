# CHANGELOG V503 — Test Status Report + realFail Fix

## מה זוהה
- **1 realFail**: `v243.test.js` נכשל כי `CHANGELOG_V243.md`, `NEXT_SESSION_PROMPT_V243.md`,
  ו-`AI_PROTOCOL_V243.md` הועברו לשגגה ל-`_archive_orphans_v497/` בV497.
- **72 cannotRun**: suites עם vitest — לא ניתנים להרצה בסביבה ללא npm. לא היה תיעוד מפורש.
- `getStatusReport503` נחוץ כדי לחשוף את מפת האמת דרך API.

## מה נבנה / תוקן
1. **תיקון realFail**: שחזור `CHANGELOG_V243.md`, `NEXT_SESSION_PROMPT_V243.md`,
   `AI_PROTOCOL_V243.md` → v243.test.js עבר מ-43/45 ל-45/45.
2. **`lib/testStatusReport503.js`** + `src/lib/` mirror:
   קורא `TEST_AUDIT.json`, מחזיר מפת אמת מובנית: pass/cannotRun/realFail, honesty field,
   failures list, cannotRun sample. Fail-closed אם JSON חסר.
3. **`tests/README.md`** — תיעוד מפורש: cannotRun = unverified (צריך vitest), לא pass ולא fail.
4. **IIFE V503** בשרת: `GET /api/v1/admin/test-status/v503` + `/admin/summary/v503`.

## אימות (מספרים מ-exit code)
- SACRED md5: ✅
- `node --check ecos-api-server.js`: ✅
- `tests/v503.test.js`: **24/24 passed, 0 failed** (exit 0)
- `scripts/audit-tests.js`: **49 pass / 72 cannotRun / 0 realFail** (היה 1 realFail)

## מה לא אומת
- 72 suites עם vitest — לא ניתן להריץ כאן. דורשים `npm install + npx vitest`.
- לא נבדק שה-API endpoint עובד תחת שרת חי (בדיקת wiring סטטית בלבד).
