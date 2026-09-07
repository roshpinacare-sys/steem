# CHANGELOG_V567.md

## V567 — AutoCorr Warm-Up Status (IIFE-only, Phase P455)

### מה זוהה
- `tokenSnapshotBuffer562` חושף `pushTokenSnapshot562` + `getAutoCorrelationScore562(rb)`.
- ה-score דורש `rb` (RankedOverlapBuffer333 instance) — ללא `rb` מחזיר שגיאה.
- לא קיים endpoint שמציג מצב warm-up (האם ה-buffer הגיע ל-5 snapshots הנדרשים).
- `libCount=646` — אסור להוסיף lib חדש (v497 constraint). IIFE-only.

### מה נבנה
**IIFE V567** (ללא קובץ lib חדש):

`GET /api/v1/market-maker/autocorr/warm-up-status/v567` מחזיר:
```json
{
  "warmedUp": false,
  "bufferSize": 2,
  "minRequired": 5,
  "maxSnapshots": 20,
  "remaining": 3,
  "fillPercent": 40,
  "message": "Warming up: 2/5 snapshots (40%). Need 3 more.",
  "scorePreview": null
}
```
כש-`warmedUp=true` מוסיף `scorePreview: { score, autocorr }` (אם rb זמין).

### תוצאות אימות
| בדיקה | תוצאה |
|---|---|
| `node --check` | ✅ PARSE_OK |
| SACRED md5 | ✅ 563e9b1f / e5a5c2c2 |
| `tests/v567.test.js` | ✅ **21/21, exit 0** |
| libCount | ✅ 646 (לא השתנה) |
| `audit-tests.js` לפני→אחרי | **164→165 pass, 19 cannotRun, 0 realFail** |

### מה לא אומת
- 19 suites דורשים vitest/ESM.
- `scorePreview` בזמן warmedUp=true לא נבדק runtime (דורש `rb` instance חי).
- Endpoints לא נבדקו עם express חי.
