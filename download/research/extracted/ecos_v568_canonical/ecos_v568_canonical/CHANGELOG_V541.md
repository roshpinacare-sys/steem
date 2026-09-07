# CHANGELOG_V541.md

## V541 — Deep Health Alert Filter: severity + category query-param (Phase P429)

### מה זוהה
V540 הוסיף `buildAlerts540()` עם מבנה `alerts[]` (id/severity/category/message/fix_url).
הצעד הטבעי: filtering בזמן-אמת לפי severity/category/limit — קיים בהמלצת V540.
לא נמצא מודול דומה קיים (grep ב-lib/).

### מה נבנה
**`deepHealthAlertFilter541.js`** — read-only filter layer על deepHealthAlerts540:

| query param | ערכים חוקיים | ברירת מחדל |
|---|---|---|
| `?severity=` | `critical\|warning\|info` | ללא סינון |
| `?category=` | `bridge\|heartbeat\|governance\|module\|unknown` | ללא סינון |
| `?limit=N` | 1–500 | 500 |

- fail-closed: ערך לא-חוקי → `filterErrors[]`, הסינון **לא מוחל** (לא קורס, לא מחזיר כלום שגוי)
- `buildFilteredAlerts541(query)` — pipeline מלא: build→parse→filter
- `FILTER_SCHEMA_541` — schema מובנה לצריכת tooling/docs
- 3 endpoints: T01 alerts, T02 schema, T03 summary

### תוצאות אימות
| בדיקה | תוצאה |
|---|---|
| `node --check` | ✅ PARSE_OK |
| SACRED md5 | ✅ 563e9b1f / e5a5c2c2 |
| `tests/v541.test.js` | ✅ **27/27, exit 0** |
| `audit-tests.js` לפני | 138 pass, 19 cannotRun, 0 realFail |
| `audit-tests.js` אחרי | **139 pass, 19 cannotRun, 0 realFail** |

### מה לא אומת
- 19 suites דורשים vitest/ESM — לא ניתן לרוץ בסביבה זו.
- Endpoints לא נבדקו runtime (אין express חי) — רק wiring ו-parse.
- `buildDeepHealth539()` תלוי בסביבת production — הטסטים בודקים את ה-filter logic בלבד.
