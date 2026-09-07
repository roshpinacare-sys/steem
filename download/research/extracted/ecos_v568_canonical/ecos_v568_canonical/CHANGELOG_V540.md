# CHANGELOG_V540.md — V540

## מה זוהה
- Baseline: **137 pass, 19 cannotRun, 0 realFail**.
- `NEXT_SESSION_PROMPT_V539` המליץ על **אפשרות B** — structured alert export (read-only, zero side-effects).
- `GET /api/v1/deep-health/v539` מחזיר actionItems[] כ-strings. V540 מעשיר אותם לפורמט מובנה לצריכה על-ידי monitoring.

## מה נבנה
**`lib/deepHealthAlerts540.js`** — Structured Alert Export:
- `buildAlerts540()` — קורא ל-`buildDeepHealth539()`, ממפה כל string ב-actionItems ל-alert מובנה:
  `{ id, severity: critical|warning|info, category: bridge|heartbeat|governance|module|unknown, message, fix_url, ts }`
- `_classifyItem540(message)` — קלסיפיקטור עם סדר בדיקות מדויק (hbRunning → heartbeat-null → bridge → governance → module)
- `registerEndpoints540(app)` — wires 2 endpoints, fail-closed על null

## Endpoints חדשים
- `GET /api/v1/deep-health/alerts/v540` (V540-T01)
- `GET /api/v1/admin/summary/v540` (V540-T02)

## חיבורים
`deepHealthAlerts540` → `deepHealthStatus539` → `aggregatedHeartbeatStatus538` + `governanceDiagnose533`

## תוצאות אימות
- בניה ראשונה: 12/14. שני כשלים — סדר בדיקות בקלסיפיקטור (bridge check לפני heartbeat תפס הודעות heartbeat שכוללות "Bridge532"). תוקן.
- `tests/v540.test.js` → **14/14 pass** (exit 0) ✓
- `scripts/audit-tests.js` → **138 pass, 19 cannotRun, 0 realFail** (+1 לעומת V539) ✓
- `node --check ecos-api-server.js` ✓ | SACRED ✓

## מה לא אומת
- **19 cannotRun** — vitest/ESM suites. לא ניתן לאמת. לא נספרו.
- Endpoints לא נבדקו עם שרת HTTP חי — unit tests בלבד.
- `fix_url` הם path יחסי בלבד (`/docs/ecos/ops/...`) — consumer אחראי להוסיף host.
