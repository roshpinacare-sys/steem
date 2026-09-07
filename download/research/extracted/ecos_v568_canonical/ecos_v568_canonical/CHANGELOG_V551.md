# CHANGELOG V551 — dispatchBridge550 Gate Patch

## Version: 551.0.0 | Phase: P310
## Author: AI (Claude Sonnet 4.6) | Date: 2026-06-06

## מה זוהה
- Baseline: **148 pass, 19 cannotRun, 0 realFail**.
- `NEXT_SESSION_PROMPT_V550`: חיווט `dispatchBridge550` לתוך `guard467` + `bridge466`.
- ניתוח: `_orchestrator467()`/`_orchestrator466()` מחזירות `require('./moduleOrchestrator437.js')` → require-cache object → monkey-patch תקף.

## מה נבנה
**V551 IIFE** — monkey-patch על `O437.executePlan437`:
- `executePlan437` מוחלף ב-`executePlan437_patched551` שקורא ל-`dispatchPlan550`.
- `authorized: ctx && ctx.authorized === true` — fail-closed לכל שאר.
- Original נשמר כ-`_origExecutePlan437_551`.
- Idempotent: בדיקת `_patched551` flag.
- Counter observability: `O437._patchStats551()` → calls/allowed/blocked/errors.

## תגלית חשובה
`dispatchPlan550` ← `gatePlan549` — gate שולט גם ב-policy score. `authorized=true` + score נמוך → `MANUAL` (fail-closed). זו התנהגות נכונה: gate בוחן הן authorization הן policy score.

## מה חובר
| מקור | תוצאה |
|------|--------|
| `diamondAutonomousGuard467` | עכשיו מגולה דרך gate549 בכל executePlan437 |
| `diamondOrchestratorBridge466` | עכשיו מגולה דרך gate549 בכל executePlan437 |
| `dispatchBridge550` → `orchestratorPolicyGate549` | שרשרת גייט מלאה |

## אימות
- **22/22 V551 tests — exit 0**.
- audit-tests.js: **149 pass (+1), 19 cannotRun, 0 realFail**.
- node --check: OK. SACRED MD5: תקין.

## מה לא אומת
- `gatePlan549` בסביבה חיה עם ניקוד גבוה מספיק לאפשר AUTO — לא בדוק.
- `_patchStats551` counters בריצה אמיתית של guard467/bridge466 — לא בדוק end-to-end.
- 19 cannotRun — ESM/vitest, לא ניתן לאמת.
