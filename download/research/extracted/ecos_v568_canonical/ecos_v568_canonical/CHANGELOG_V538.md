# CHANGELOG V538 — Aggregated Heartbeat-Governance Status (hbRunning Fix)

## תאריך
2026-06-05

## מה זוהה
- **V534 bug**: `_hb532_534 = null` עם הערה "heartbeat not accessible outside V532 IIFE"
  → `hbRunning` תמיד false גם כשה-heartbeat חי
- V537 תיקן עבור endpoint שלו, אבל לא עבור V534
- baseline: pass=135, cannotRun=19, realFail=0

## מה נבנה
- **`lib/aggregatedHeartbeatStatus538.js`** + `src/lib/aggregatedHeartbeatStatus538.js`
  - `buildAggregatedStatus538(opts)` — מאגד V532→V534→V536→V537
  - קורא `Bridge532.activeHb532` ישירות (לא `_hb532_534=null`)
  - 3 phases: bridge532, hb532 (with real hbRunning), healthGate534 (optional)
  - fail-closed: null Bridge → unhealthy, bridge present + hb null → degraded
  - `hbFix` field מתעד את התיקון
- **IIFE בסוף השרת** — הוספה בלבד, אין שינוי ב-IIFEs קיימים

## מה חובר
- `GET /api/v1/diamond/heartbeat/governance/aggregate/v538` — aggregated status
- `GET /api/v1/admin/summary/v538`

## אימות
- `node --check` → PARSE OK
- `tests/v538.test.js` → **10/10** (exit 0)
- `audit-tests.js` → **pass=136 (+1), cannotRun=19, realFail=0** (0 regressions)
- SACRED md5: intact

## מה לא אומת
- 19 suites cannotRun (vitest/ESM) — לא ניתן לאמת כאן
- endpoints לא נבדקו ב-HTTP אמיתי (אין supertest)
- V534 endpoint `/health` עצמו עדיין מחזיר `hbRunning:false` (לא שונה — V538 מספק חלופה)
