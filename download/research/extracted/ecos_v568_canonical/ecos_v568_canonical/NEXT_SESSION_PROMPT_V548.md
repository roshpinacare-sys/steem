# NEXT_SESSION_PROMPT_V548 — Start of V549

## מצב ב-V548
גרסה **548.0.0**. audit: **146/165 pass, 19 cannotRun, 0 realFail**.

## Pre-flight
```bash
md5sum lib/fiatLedger.js   # 563e9b1f9e67091a5b6527c0a92568e5
md5sum lib/auditLog.js     # e5a5c2c27801d2d03991bc8e5a1df8cb
node --check ecos-api-server.js
NODE_ENV=test node tests/v548.test.js   # 16/16
node scripts/audit-tests.js             # 146/19/0
```

## Convention (אל תשנה)
- `deepHealthPolicyLog548` — in-memory ring buffer. לא נגע בלי re-export.
- `gatePlan547` — entry point לכל אוטונומיה.
- `node_modules/ws/index.js` + `node_modules/commander/index.js` — vendored stubs. אל תעדכן עם npm.

## הצעד הבא — V549

**חיבור: wire recordDecision548 לתוך gatePlan547**

כרגע `gatePlan547` מחזיר decision אבל לא לוגג אותו ל-policyLog548.
V549 מוסיף integration: כל קריאה ל-`gatePlan547` → auto-logs ל-`deepHealthPolicyLog548`.

**גישה מומלצת**: בנה `orchestratorPolicyGate549.js` שעוטף gate547 + מוסיף logging:
```js
function gatePlan549(plan, opts) {
  const result = require('./orchestratorPolicyGate547.js').gatePlan547(plan, opts);
  require('./deepHealthPolicyLog548.js').recordDecision548({
    decision:  result.gateDecision || result.policy?.decision,
    score:     result.policy?.score ?? 0,
    trend:     result.policy?.trend ?? 'unknown',
    reasoning: result.reason,
    source:    'gate549',
    blocked:   result.blocked,
  });
  return result;
}
```

**ודא**: gate547 לא נשבר. IIFEs קיימים שומרים require('./orchestratorPolicyGate547') — הם ממשיכים לעבוד.
gate549 הוא wrapper בלבד — expose אותו endpoint ב-/api/v1/autonomy/gate/v549.

**כלל קשיח**: 0 npm deps. SACRED לא לגעת. exit 0 לפני אריזה.
