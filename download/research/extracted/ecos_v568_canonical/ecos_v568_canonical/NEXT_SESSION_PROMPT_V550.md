# NEXT_SESSION_PROMPT_V550 — Start of V551

## מצב ב-V550
**550.0.0** | audit: **148/167 pass, 19 cannotRun, 0 realFail**.

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
NODE_ENV=test node tests/v550.test.js      # 21/21
node scripts/audit-tests.js               # ≥148 pass / 19 cannotRun / 0 realFail
```

## Convention שמור
- `dispatchBridge550.js` ≠ `agentDispatchBridgeNNN.js` — שם שונה בכוונה (tower collision).
- `node_modules/ws`, `commander` — vendored stubs, אל תגע.
- selfExcludes בטסטים: `v510, v528, v534` — circular audit loop, שמור.
- audit-tests.js דורש **שתי ריצות רצופות** כדי להתייצב ל-0 realFail (bootstrap).

## הצעד הבא — V551

**חיווט `dispatchBridge550` לתוך `diamondAutonomousGuard467` ו-`diamondOrchestratorBridge466`**

האתגר: לא לשנות קבצי lib קיימים. הגישה: **server-side monkey-patch ב-IIFE**:

```js
// ב-IIFE V551:
const guard467 = require('./lib/diamondAutonomousGuard467.js');
const bridge466 = require('./lib/diamondOrchestratorBridge466.js');
const D550 = require('./lib/dispatchBridge550.js');

// monkey-patch: החלף את executePlan437 בתוך ה-modules
// (ה-require cache מבטיח שכולם יראו את ה-patch)
const O437 = require('./lib/moduleOrchestrator437.js');
const _orig = O437.executePlan437;
O437.executePlan437 = function(plan, ctx) {
  return D550.dispatchPlan550(plan, ctx, { authorized: ctx && ctx.authorized, allowFallback: true });
};
```

⚠️ בדוק קודם: `grep -n "executePlan437" lib/diamondAutonomousGuard467.js` —
וודא שהם עושים `orch.executePlan437(...)` ולא `O437.executePlan437(...)` ישירות.
אם הם דרך variable מקומי — monkey-patch על O437 לא יעבוד. במקרה כזה: בנה IIFE
שעוטף את שתי הפונקציות שמשתמשות ב-executePlan437 ישירות.

**כלל**: 0 npm deps. SACRED לא לגעת. exit 0 + 0 realFail לפני אריזה.
