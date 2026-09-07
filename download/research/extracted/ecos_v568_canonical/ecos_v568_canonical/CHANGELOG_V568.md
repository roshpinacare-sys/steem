# CHANGELOG_V568.md

## V568 — AutoCorr Seed Batch (IIFE-only, Phase P456)

### מה זוהה
- `tokenSnapshotBuffer562.pushTokenSnapshot562(string[])` עובד אחד-אחד.
- V567 הוסיף warm-up status — אבל הדרך למלא את ה-buffer היתה קריאות רבות לendpoint נפרד.
- אין batch endpoint שמאיץ warm-up בקריאה אחת.
- libCount=646 — IIFE-only חובה.

### מה נבנה
**IIFE V568** (ללא lib חדש):

`POST /api/v1/market-maker/autocorr/seed/batch/v568`
- Body: `{ batches: [string[], ...] }` — עד 50 batches בקריאה אחת
- fail-closed: `batches` לא-array → 400 BAD_ARGS_568; יותר מ-50 → 400 TOO_MANY_BATCHES_568
- מחזיר: `pushed`, `skipped`, `bufferSize`, `warmedUp`, `remaining`, `errors[]` (entries שנדחו)
- מחבר ל-warm-up-status/v567 דרך `warmUpStatusUrl` בתגובה

### תוצאות אימות
| בדיקה | תוצאה |
|---|---|
| `node --check` | ✅ PARSE_OK |
| SACRED md5 | ✅ 563e9b1f / e5a5c2c2 |
| `tests/v568.test.js` | ✅ **20/20, exit 0** |
| libCount | ✅ 646 (לא עלה) |
| `audit-tests.js` לפני→אחרי | **165→166 pass, 19 cannotRun, 0 realFail** |

### מה לא אומת
- 19 suites דורשים vitest/ESM.
- Endpoints לא נבדקו runtime עם express חי.
- `tests/v497.test.js` (`libCount < 645`) עדיין שבור — ממתין לתיאום.
