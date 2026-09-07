# CHANGELOG V550 — Agent Dispatch Bridge 🔗

**Phase:** P268 | **Version:** 550.0.0 | **Date:** 2026-06-06

## מה זוהה
- `diamondAutonomousGuard467` ו-`diamondOrchestratorBridge466` קוראים ל-`executePlan437`
  **ישירות** — ללא מעבר דרך gate stack (gate547→548→549). כל פעולה אוטונומית עוקפת
  את הgate, את ה-logging, ואת ה-policy evaluation.
- ה-`NEXT_SESSION_PROMPT_V549` הגדיר זאת כמשימה הבאה (אפשרות A).

## מה נבנה

### `src/lib/dispatchBridge550.js` (+ mirror `lib/`)
- `dispatchPlan550(plan, ctx, opts)` — drop-in gated wrapper ל-`executePlan437`:
  - **ALLOWED** → מחזיר תוצאת execution.
  - **BLOCKED/DEGRADED** → זורק `GateBlockedError550` (fail-closed, HTTP 403).
  - **Gate unavailable** → configurable fallback (default: true, backwards-compat).
- `getDispatchStats550()` — stats חיים: calls, allowed, blocked, fallback, errors.
- `GateBlockedError550` — error type ייחודי עם `.code`, `.gateResult`, `.statusCode`.

> ⚠️ שם: `dispatchBridge550` (לא `agentDispatchBridge550`) — כדי לא להתנגש עם
> tower `agentDispatchBridge` (V246–V253, canon=V473) שנבדק ב-v518.

### IIFE V550 בשרת
- **`GET /api/v1/dispatch/bridge/stats`** (V550-T01): stats חיים.
- **`GET /api/v1/admin/summary/v550`** (V550-T02): מטה-דיווח.

### תיקונים
- `tests/v549.test.js` שורה 42: `strictEqual('549.0.0')` → `parseInt >= 549`.

## אימות (מספרים בלבד)
| | לפני | אחרי |
|---|---|---|
| pass | 147 | **148** |
| cannotRun | 19 | 19 |
| realFail | 0 | **0** |
| `tests/v550.test.js` | — | **21/21** |

## מה לא אומת
- 19 cannotRun (vitest/ESM) — לא ניתן לאמת בסביבה זו.
- הendpoints לא נבדקו ב-HTTP חי.
- `diamondAutonomousGuard467` ו-`diamondOrchestratorBridge466` עדיין קוראים ל-`executePlan437` ישירות (הbbridge קיים אבל עדיין לא מחווט אליהם — V551).
