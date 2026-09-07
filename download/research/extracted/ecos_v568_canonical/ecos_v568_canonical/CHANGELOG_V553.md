# CHANGELOG_V553.md — ECOS V553

## תאריך: 2026-06-05 | Phase P321 | Author: AI (Sonnet 4.6)

## מה זוהה
- NEXT_SESSION_V552: `attach544()` מחזיר `ok:false` בגלל שאין heartbeat פועם ב-boot.
- בדיקה אמפירית: `push542({}, 'seed')` × 10 → `getTrend542()` מחזיר `stable` (priorN=5, recentN=5).
- קריטי: ring buffer ריק → trend='unknown' → gate549 decision=MANUAL — שרשרת תקועה.
- grep אימת: אין `schedulerSeed`, `trend/live`, `trendSeedBridge` בשרת. בטוח לבנות.

## מה נבנה (פעולה C — Connection)
- **`lib/trendSeedBridge553.js`** + **`src/lib/trendSeedBridge553.js`** (זהים):
  - `seedTrend553(n)` — n pushes לring buffer + ניסיון attach של scheduler (idempotent). cap ב-30 (fail-closed).
  - `getTrendStatus553()` — קריאה ללא כתיבה: trend נוכחי + scheduler state.
  - fail-closed: n>30 נחתך לdefault=10; n=0 → default.

- **Boot action בשרת:** `seedTrend553(10)` מופעל אוטומטית ב-IIFE.
- **`POST /api/v1/deep-health/scheduler/seed`** — re-seed ידני (body: `{ n }`).
- **`GET /api/v1/deep-health/trend/live`** — trend + scheduler state.
- **`GET /api/v1/admin/summary/v553`** — סיכום עם liveTrend + schedulerAttached.

## תוצאות אימות
- `node tests/v553.test.js`: **16/16 passed, exit 0**.
- `node scripts/audit-tests.js`: **151 pass, 19 cannotRun, 0 realFail** (לפני: 150/19/0).
- SACRED md5: ✓. `node --check`: ✓ SYNTAX OK.

## מה לא אומת
- 19 cannotRun (vitest/ESM).
- ה-boot seed נבדק ב-unit — לא נבדק שה-IIFE אכן מפעיל אותו ב-production startup (אין express running בסביבה זו).
- gate549 לא נבדק end-to-end — היכולת תלויה בהפעלת heartbeat.
