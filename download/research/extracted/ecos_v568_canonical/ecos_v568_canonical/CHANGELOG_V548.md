# CHANGELOG V548

## זוהה
- ה-stack policy/gate (546→547) לא שמר היסטוריה של decisions — אין observability.
- אין דרך לדעת האם המערכת משתפרת (MANUAL→AUTO) או מדרדרת לאורך זמן.

## מה נבנה
- **`lib/deepHealthPolicyLog548.js`** + **`src/lib/`** (mirror):
  - `recordDecision548(entry)` — append to ring buffer (fail-closed: BOGUS decisions נדחות)
  - `getLog548()` — כל ה-log (עד 50 entries)
  - `getTrendLog548()` — improving/degrading/stable/unknown (first-half vs second-half avg)
  - `getLogSummary548()` — counts per decision + blockedCount + trend + lastDecision
  - `clearLog548()` — לטסטים
  - `DECISION_LEVELS_548`: AUTO=2, SUPERVISED=1, MANUAL=0 (numeric scale לtrend calc)
- **IIFE V548** בשרת:
  - `GET  /api/v1/health/policy-log`         — כל ה-log
  - `GET  /api/v1/health/policy-log/summary` — summary + live probe
  - `POST /api/v1/health/policy-log/record`  — append ידני (validation: AUTO/SUPERVISED/MANUAL בלבד)
  - `GET  /api/v1/admin/summary/v548`
- שינוי מ-T11: הוספת `_VALID_DECISIONS_548` — reject invalid decisions (fail-closed)

## אימות
- `node --check ecos-api-server.js` → OK
- SACRED md5: fiatLedger ✅ auditLog ✅
- `NODE_ENV=test node tests/v548.test.js` → **16/16 pass, 0 fail**
- `node scripts/audit-tests.js` → **146/165 pass** (↑145), **19 cannotRun**, **0 realFail**

## מה לא אומת
- 19 cannotRun — כולם pg-dependent (PostgreSQL). לא ניתנים ללא DB.
- ring buffer הוא in-memory — איפוס בכל restart. לא נבדקה persistence.
