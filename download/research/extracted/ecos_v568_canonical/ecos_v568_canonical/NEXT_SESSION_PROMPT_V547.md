# NEXT_SESSION_PROMPT_V547.md — Start of V548

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js    # 563e9b1f / e5a5c2c2
NODE_ENV=test node tests/v547.test.js       # 16/16
node scripts/audit-tests.js                # 145/19/0
```

## Convention שמור (אל תשנה)
- `heartbeatGovernanceBridge532.activeBridge532/activeHb532` — getter/setter, V532 מאכלס.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תצמצם.
- `_classifyItem540`: סדר קריטי — hbRunning, activeHb, bridge.
- `marketMakerCanon543` הוא ה-tip. `deepHealthHistoryScheduler544` מפעיל push542.
- `gatePlan547` — entry point לכל אוטונומיה. לא לעקוף.

## Architecture נוכחי (stack שלם):
```
DiamondHeartbeat465
  └─ heartbeatGovernanceBridge532
       └─ deepHealthStatus539
            └─ deepHealthAlerts540
                 └─ deepHealthAlertFilter541
                      └─ deepHealthAlertHistory542
                           ├─ deepHealthHistoryScheduler544
                           ├─ deepHealthAlertAggregator545
                           └─ deepHealthPolicy546 (AUTO/SUPERVISED/MANUAL)
                                └─ orchestratorPolicyGate547 (gate) ← NEW
                                     └─ moduleOrchestrator437 (execute)
```

## הצעד הבא — V548

**אפשרות A — Policy Log** (מומלץ, Priority B/E):
`deepHealthPolicyLog548.js` — ring buffer של decisions (כמו history542 אבל על decisions policy).
שומר 50 decisions אחרונות עם timestamp, score, trend. מאפשר לראות trend של AUTO→SUPERVISED→MANUAL לאורך זמן.
`getTrendLog548()` — trend של decisions עצמם (האם המערכת משתפרת/מדרדרת).

**אפשרות B — Audit Trail for Gate**:
כל קריאה ל-`gatePlan547` → כתוב ל-`auditLog.js` (SACRED append). כך כל פעולה אוטונומית שנחסמת מתועדת.
⚠️ דורש הבנת ממשק auditLog (SACRED) — בדוק read-only מתוך SACRED.

**אפשרות C — Agent Dispatch Integration**:
חפש `agentDispatch` / `agentRuntime` — האם הם מבצעים plans דרך executePlan437 ישירות?
אם כן — החלף ל-gatePlan547 כך שכל dispatch של סוכן עובר דרך ה-gate.

**המלצה: A** — Policy Log. לא תלוי ב-heartbeat חי, בטוח, מוסיף observability לgate.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-548. IIFE בסוף. tests/v548.test.js exit 0.
- דווח: X/Y pass לפני→אחרי (מ-145), cannotRun (19), realFail (0).
- חובה: "מה לא אומת".
