# CHANGELOG V546

**Release:** ECOS V546 · 2026-06-06

## מה זוהה
- Stack deep-health מ-V539 עד V545 מוכן (heartbeat → status → alerts → filter → history → scheduler → aggregator) אבל חסר פלט אחד: **החלטה** — מה עושים עם כל המידע הזה?
- `GET /api/v1/status` מחזיר signal=YELLOW אבל לא מחליט AUTO/SUPERVISED/MANUAL.

## מה נבנה
**`src/lib/deepHealthPolicy546.js`** (+ mirror ב-`lib/`):

מחבר 3 מקורות קיימים → החלטת auto/supervised/manual:
1. `marketMakerCanon543.getCompositeScore543()` — composite score [0..1]
2. `deepHealthAlertHistory542.getTrend542()` — rising/falling/stable/unknown
3. `deepHealthAlertAggregator545.aggregate545()` — bucket stats

לוגיקה (fail-closed):
- `score≥0.70 AND trend≠rising AND trend≠unknown` → **AUTO**
- `score≥0.40 AND trend≠rising AND trend≠unknown` → **SUPERVISED**
- כל שאר → **MANUAL** (כולל trend=rising/unknown, כולל load errors)

**V546 IIFE** בשרת:
- `GET /api/v1/deep-health/policy/v546` — decision מלא + reasoning
- `GET /api/v1/deep-health/policy/explain/v546` — one-liner
- `GET /api/v1/admin/summary/v546`

## תוצאות אימות
- SACRED ✅ (563e9b1f / e5a5c2c2)
- `node --check` ✅
- `tests/v546.test.js` → **15/15, exit 0** ✅
- `scripts/audit-tests.js` → **144/163 pass** (143→144), **19 cannotRun**, **0 realFail** ✅

## מה לא אומת
- 19 cannotRun: express×14 + pg×2 + vitest-globals×3 — בעיית סביבה, לא קוד.
- Policy engine נבדק עם score=0/trend=unknown (test env = fail-closed = MANUAL). לא נבדק עם score>0.7 חי (דורש heartbeat פעיל).
