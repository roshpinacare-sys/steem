# CHANGELOG_V542.md

## V542 — Deep Health Alert History Ring Buffer (Phase P430)

### מה זוהה
`deepHealthAlertFilter541` חושף `buildFilteredAlerts541(query)` — מצב הסתה snapshot ברגע מסוים.
אין יכולת לראות מגמות: האם alerts גוברים? מתי הם הופיעו? → חסר ring buffer.

### מה נבנה
**`deepHealthAlertHistory542.js`** — wraps deepHealthAlertFilter541:
- Ring buffer גמיש (ברירת-מחדל N=50, clamp [5,500])
- `push542(query, source)` — לוכד snapshot (alertCount, criticalCount, warningCount, infoCount, ok, ts, seqNo)
- `getHistory542(opts)` — query: limit, since (ISO), onlyDegraded; מחזיר newest-first
- `getTrend542()` — משווה avg(criticalCount) last-WINDOW vs prior-WINDOW → rising/falling/stable/unknown
- `setMax542(n)` — שינוי גודל buffer בזמן ריצה
- `registerEndpoints542(app)` — 3 endpoints: V542-T01..T03
- IIFE בסוף השרת, משוקף ב-lib/ ו-src/lib/

### תוצאות אימות (exit code בלבד)
| בדיקה | תוצאה |
|---|---|
| `node --check` | ✅ PARSE_OK |
| SACRED md5 | ✅ 563e9b1f / e5a5c2c2 |
| `tests/v542.test.js` | ✅ **18/18, exit 0** |
| `tests/v541.test.js` | ✅ 27/27, exit 0 |
| audit לפני → אחרי | ✅ **139→140 pass, 19 cannotRun, 0 realFail** |

### מה לא אומת
- 19 suites דורשים vitest/ESM — לא רצים כאן; לא עובר ולא נכשל.
- `getTrend542` נבדק לצורה בלבד — לא נבדק עם מספיק data לראות rising/falling (צריך >2×TREND_WINDOW=10 snapshots).
- endpoints לא נבדקו ב-runtime אמיתי (אין express חי).
- `push542` קורא ל-`buildFilteredAlerts541` שעצמו תלוי ב-`buildAlerts540` — שני שכבות של `cannotRun` אם הדיפנדנסי חסר; fail-closed מכוסה.
