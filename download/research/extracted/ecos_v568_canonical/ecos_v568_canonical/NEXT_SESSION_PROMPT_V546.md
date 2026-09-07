# NEXT_SESSION_PROMPT_V546.md — Start of V547

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js    # 563e9b1f / e5a5c2c2
NODE_ENV=test node tests/v546.test.js       # 15/15
node scripts/audit-tests.js                # 144/19/0
```

## Convention שמור (אל תשנה)
- `heartbeatGovernanceBridge532.activeBridge532` / `.activeHb532` — getter/setter, V532 מאכלס.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תצמצם.
- `_classifyItem540`: סדר קריטי — hbRunning, activeHb, bridge.
- `marketMakerCanon543` הוא ה-tip. `deepHealthHistoryScheduler544` מפעיל `push542`.

## Stack deep-health (שלם):
```
DiamondHeartbeat465
  └─ heartbeatGovernanceBridge532
       └─ deepHealthStatus539
            └─ deepHealthAlerts540
                 └─ deepHealthAlertFilter541
                      └─ deepHealthAlertHistory542 (ring N=50)
                           ├─ deepHealthHistoryScheduler544 (auto-push)
                           ├─ deepHealthAlertAggregator545 (hourly buckets)
                           └─ deepHealthPolicy546 (AUTO/SUPERVISED/MANUAL ← NEW)
```

## הצעד הבא — V547

**אפשרות A — Orchestrator Bridge** (מומלץ, Priority C):
חבר `deepHealthPolicy546.getPolicy546()` ל-Orchestrator (V437):
כשdecision=AUTO → Orchestrator מורשה לפעול; כשMANUAL → נחסם.
בדוק תחילה:
```bash
grep "orchestrator\|V437\|getOrchestrator" lib/ -r | grep "module.exports" | head -5
```
אם V437 Orchestrator חושף `setActionGate` / `isPolicyGated` → חבר את policy546 כ-gate.

**אפשרות B — Policy History**:
`deepHealthPolicyLog547.js` — ring buffer של החלטות policy (כמו history542 אבל על decisions).
מאפשר לראות trend של AUTO→SUPERVISED→MANUAL.

**אפשרות C — Governance Cycle Integration**:
חבר policy546 ל-`diamondGovernanceCycle499` — כשdecision=MANUAL → cycle מוציא alert.

**כללים**:
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-547. IIFE בסוף. tests/v547.test.js exit 0.
- דווח: X/Y pass לפני→אחרי (מ-144), cannotRun (19), realFail (0).
- חובה: "מה לא אומת".
