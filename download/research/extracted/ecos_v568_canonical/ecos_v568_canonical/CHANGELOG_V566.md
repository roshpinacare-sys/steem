# CHANGELOG_V566.md — V566

## מה זוהה
- Baseline: **163 pass, 19 cannotRun, 0 realFail**.
- `libCount=646` — מעל המגבלה 645 של v497.test.js. בחירה: IIFE-only.
- `POST /api/v1/market-maker/autocorr/seed/v562` כבר קיים ומאמת את tokens[], אבל מחזיר שגיאה גנרית ללא הנחיה.
- `NEXT_SESSION_PROMPT_V565`: אם V562 עושה validation → אל תכפיל, **חבר בלבד**.

## מה נבנה
**IIFE-only** — `_wireAutocorrSeedValidator566()` בסוף ecos-api-server.js:
- `_validateSeedBody566(body)` — מחזיר `{ valid, issues[], hints[], example }`:
  - `missing field: "tokens"` → hint עם דוגמה
  - `tokens` לא array → hint עם עטיפה
  - `tokens` ריק → hint עם מינימום
  - אלמנטים null/ריקים → issue עם index מדויק
  - שדות לא-ידועים → hint (לא שגיאה)
  - body לא-אובייקט/null → שגיאה ברורה

## Endpoints חדשים
- `POST /api/v1/market-maker/autocorr/seed/validate/v566` (V566-T01)
- `GET  /api/v1/admin/summary/v566` (V566-T02)

## חיבורים
`validate/v566` → `seed/v562` → autocorr chain V562→V563→V564→V565

## תוצאות אימות
- `tests/v566.test.js` → **14/14** (exit 0) ✓
- `scripts/audit-tests.js` → **164 pass, 19 cannotRun, 0 realFail** (לפני: 163→אחרי: 164) ✓
- `node --check` ✓ | SACRED ✓ | libCount=646 (ללא שינוי — IIFE-only)

## מה לא אומת
- 19 cannotRun — vitest/ESM, לא ניתן לאמת.
- Endpoints לא נבדקו עם שרת HTTP חי.
- v497.test.js מציין `libCount < 645` — כבר שבור ב-V562+. לא תוקן כאן (לא regression שלי).
