# NEXT_SESSION_PROMPT_V504.md — Start of V505

## מצב ב-V504
- 504.0.0. `GET /api/v1/status` — Diamond Posture live. signal=YELLOW (debtScore=75).
- 50/122 pass, 72 cannotRun, 0 realFail. SACRED intact.

## Pre-flight
```bash
node scripts/audit-tests.js
node --check ecos-api-server.js
NODE_ENV=test node tests/v504.test.js
md5sum lib/fiatLedger.js lib/auditLog.js
```

## הצעד הבא הכי בעל-מינוף: הורד debtScore מ-75

`GET /api/v1/status` מחזיר כעת `signal=YELLOW` כי `debtScore=75 > 50`.
`GET /api/v1/registry/consolidate` יחזיר את רשימת המגדלים.

**המשימה**: בדוק אם יש parallel-duplicate (לא inheritance-chain) בין מגדלים.
השיטה:
```bash
node -e "const r = require('./lib/towerRegistryMap469.js'); console.log(JSON.stringify(r.getConsolidationReport469().towers.slice(0,5), null,2))"
```
- **Inheritance-chain**: כל מודול עושה require של קודמו → **אל תהפוך ל-thin re-export**
- **Parallel-dup**: כל מודול עצמאי, אותו API → **בטוח ל-thin re-export**

עבור כל parallel-dup שמזוהה: החלף ל-`module.exports = require('./<canonical>.js')` ואמת שהטסטים לא נשברים.
debtScore אמור לרדת עם כל החלפה.
