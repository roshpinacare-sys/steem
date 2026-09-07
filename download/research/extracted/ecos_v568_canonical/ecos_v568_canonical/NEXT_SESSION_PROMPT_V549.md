# NEXT_SESSION_PROMPT_V549 — Start of V550

## מצב ב-V549
גרסה **549.0.0**. audit: **147/166 pass, 19 cannotRun, 0 realFail**.

## Pre-flight
```bash
md5sum lib/fiatLedger.js   # 563e9b1f9e67091a5b6527c0a92568e5
md5sum lib/auditLog.js     # e5a5c2c27801d2d03991bc8e5a1df8cb
node --check ecos-api-server.js
NODE_ENV=test node tests/v549.test.js   # 16/16
node scripts/audit-tests.js             # 147/19/0
```

## Stack עכשיו (עם gate549):
```
gatePlan549  ← entry point עם logging
  ├─ gatePlan547 (execute, return result)
  └─ recordDecision548 (log, non-fatal)
        └─ deepHealthPolicyLog548 (ring buffer)
```

## Convention (אל תשנה)
- `node_modules/ws/index.js` + `node_modules/commander/index.js` — vendored stubs. אל תגע עם npm.
- `tests/v548.test.js` שורה 42 — `parseInt(pkg.version) >= 548` (הורפה). שמור כך.
- gate547 לא נשבר — IIFEs קיימים שומרים require gate547 ישירות.

## הצעד הבא — V550

**אפשרות A: מצא callers ישנים של gate547/executePlan437 וסנן אם הם מוכנים ל-gate549**

```bash
grep -rn "executePlan437\|gatePlan547" lib/ src/ ecos-api-server.js | grep -v "gate549\|gate547\.js\|test" | head -20
```

אם יש callers ישנים שמבצעים אוטונומיה ישירות דרך executePlan437 **ללא** gate:
- בנה `agentDispatchBridge550.js` שמחליף executePlan437 direct ב-gatePlan549.

**אפשרות B: pg stub למחיקת cannotRun**

```bash
head -40 tests/stats.test.js
grep -n "require\|pg\|pool\|query" tests/stats.test.js | head -20
```

בדוק אם stats.test.js ניתן לניתוק מ-pg עם mock Pool.

**המלצה: B** — כל cannotRun→pass הוא progress ממשי. Option A הוא risky (callers לא ידועים עלולים לשבור).

**כלל**: 0 npm deps. SACRED לא לגעת. exit 0 + 0 realFail לפני אריזה.
