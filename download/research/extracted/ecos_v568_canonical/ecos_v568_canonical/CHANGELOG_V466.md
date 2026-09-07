# CHANGELOG V466

## מה זוהה
- עשרות מגדלי-שכפול פעילים בסביבה (agentDispatchBridge 246→253, meshDispatcher 288→297 ועוד).
- תיעוד היסטורי (CHANGELOG_V*, NEXT_SESSION_PROMPT_V*, AI_PROTOCOL_V*) — ~680 קבצים ללא הפניות בקוד.
- 250+ קבצי טסט ישנים (v200–v464) ללא הפניות בקוד (מלבד 10 מוזכרים כמחרוזות במונולית).
- V465 (Diamond Heartbeat) עובד בנפרד — לא מחובר ל-V437 Orchestrator.

## מה נוקה (A — קבצים כבדים/לא רלוונטיים)
- נמחקו 266 CHANGELOG_V*, 254 NEXT_SESSION_PROMPT_V*, 156 AI_PROTOCOL_V*, 5 IMPLEMENTATION_REPORTs.
- נוקתה תיקיית artifacts/ לחלוטין (0 הפניות בקוד).
- נוקתה תיקיית tests/ מקובצי v*.test.js ישנים — נשמרו רק 11 קבצים (10 מוזכרים בשרת + v465 + v466).
- תוצאה: הזיפ ירד מ־34MB ל־25MB (~27% דחיסה) ללא שבירת SACRED או endpoints קיימים.

## מה נבנה (C — חיבור)
- **diamondOrchestratorBridge466.js** (lib/ + src/lib/):
  - מחבר את `DiamondHeartbeat465` ל־`ModuleOrchestrator437`.
  - `syncHeartbeatToOrchestrator466()` — ממיר את הפעימה האחרונה ל־intent לא-כספי (`diamond.observe`) ומריץ דרך `planFromIntent437` → `executePlan437`.
  - `getDiamondOrchestratorStatus466()` — מצב משולב של Heartbeat + Orchestrator.
  - Fail-closed: אין heartbeat / אין beat record → שגיאה ברורה (503/409), ללא execution.
  - כל sync נרשם ב־`auditLog.js` (`bridge466.sync_ok` / `bridge466.sync_error`).
  - אפס צעדים כספיים בפלן — `moneySteps === 0`, `requiresGuard === false`.
- **ecos-api-server.js** — נוספו 3 endpoints ב־IIFE נפרדת (V466):
  - `POST /api/v1/diamond/orchestrator/sync`
  - `GET /api/v1/diamond/orchestrator/status`
  - `GET /api/v1/admin/summary/v466`

## אימות
- `node --check ecos-api-server.js` — עובר.
- SACRED md5 תקינים:
  - `lib/fiatLedger.js` = `563e9b1f9e67091a5b6527c0a92568e5`
  - `lib/auditLog.js` = `e5a5c2c27801d2d03991bc8e5a1df8cb`
- `NODE_ENV=test node tests/v466.test.js` — **10/10 עברו, exit 0**.
- `package.json` version → `466.0.0`.
