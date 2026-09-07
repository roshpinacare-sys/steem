# CHANGELOG V547

**Release:** ECOS V547 · 2026-06-06

## מה זוהה
Priority C פתוח: `deepHealthPolicy546` מחזיר AUTO/SUPERVISED/MANUAL אבל אין מי שמאזין — ה-Orchestrator V437 מריץ תוכניות ללא gate. `moduleOrchestrator437` חושף `executePlan437` אך ללא מנגנון policy.

## מה נבנה
**`src/lib/orchestratorPolicyGate547.js`** (+ mirror ב-`lib/`):

Policy-gated wrapper ל-executePlan437:
- `MANUAL` → block לחלוטין; מחזיר `{ blocked:true, reason: ... }` (fail-closed)
- `SUPERVISED` → מריץ עם `requiresOversight=true` ב-ctx ובתוצאה
- `AUTO` → pass-through נקי
- כל מקור שנפל (policy/orch unavailable) → MANUAL (fail-closed)
- `_stats547` — מונה session-scoped (total/auto/supervised/blocked/errors)

**V547 IIFE** בשרת:
- `GET /api/v1/orchestrator/policy-gate/v547` — מצב gate נוכחי + stats
- `POST /api/v1/orchestrator/policy-gate/probe/v547` — בדיקת capability
- `GET /api/v1/admin/summary/v547`

## תוצאות אימות
- SACRED ✅ (563e9b1f / e5a5c2c2)
- `node --check` ✅
- `tests/v547.test.js` → **16/16 pass, exit 0** ✅
- `scripts/audit-tests.js` → **145/164 pass** (144→145), **19 cannotRun, 0 realFail** ✅

## מה לא אומת
- 19 cannotRun — express×14, pg×2, vitest-globals×3: בעיית סביבה.
- Gate נבדק ב-test env (score=0, trend=unknown → MANUAL). לא נבדק עם score>0.7 חי (AUTO/SUPERVISED paths).
- `gatePlan547` עם תוכנית כספית (money step) לא נבדק ב-test env (דורש guardMint402 מוזרק).
