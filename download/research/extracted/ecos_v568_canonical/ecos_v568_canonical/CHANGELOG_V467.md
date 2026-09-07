# CHANGELOG V467

## מה זוהה
- מגדלי-שכפול רבים עדיין פעילים בסביבה (B לא הושלם במלואו).
  ניסיון לאיחוד `ussdSmsStateMachine265-268` נזנח כי שמות-שיטות מסומני-גרסה שונים בין גרסאות — thin re-export פשוט שובר את הטסטים הקיימים (`getPerf267` vs `getPerf268`).
  נדרשת אסטרטגיית deprecation/aliasing מובנית לפני איחוד מגדלים כאלה.
- V466 חיבר Diamond Heartbeat ל-Orchestrator עם צעדים לא-כספיים בלבד.
  השלב הלוגי הבא: חיבור לפעולה אוטונומית **כספית** עם Audit מלא ו-V402 guard.

## מה נבנה (D — פעולה אוטונומית כספית עם Audit מלא)
- **diamondAutonomousGuard467.js** (lib/ + src/lib/):
  - `actWithGuard467(opts)` — קוראת את ה-heartbeat האחרון, מחשבת דחיפות (`urgency`) מ-`earlyWarnings` + `proactiveDecisions`, ובונה תוכנית כספית מונעת-סיכון.
  - `_computeUrgency467(beat)` — fail-closed: נתונים חסרים → urgency=0.
  - `_buildPreemptivePlan467(beat, urgency)` — יוצרת צעדי `money` סמליים (tighten / health_inject / guard_test) לפי מצב המערכת.
  - כל צעד כספי עובר דרך `guardMint402` / `guardWithdraw402` (V402) דרך ה-Orchestrator (V437).
  - אפס מפתחות בידי הסוכן/יהלום — ה-guard מחזיק את ההגנות.
  - כל פעולה מתועדת ב-`auditLog.js` (`guard467.act_ok` / `guard467.act_error` / `guard467.act_skipped`).
- **ecos-api-server.js** — נוספו 2 endpoints ב-IIFE נפרדת (V467):
  - `POST /api/v1/diamond/orchestrator/act` — מריץ `actWithGuard467` עם תמיכה ב-`dryRun`, `threshold`, `hitlApproved`, `reserveStatus`.
  - `GET /api/v1/admin/summary/v467` — meta.

## אימות
- `node --check ecos-api-server.js` — עובר.
- SACRED md5 תקינים:
  - `lib/fiatLedger.js` = `563e9b1f9e67091a5b6527c0a92568e5`
  - `lib/auditLog.js` = `e5a5c2c27801d2d03991bc8e5a1df8cb`
- `NODE_ENV=test node tests/v467.test.js` — **13/13 עברו, exit 0**.
- `package.json` version → `467.0.0`.
