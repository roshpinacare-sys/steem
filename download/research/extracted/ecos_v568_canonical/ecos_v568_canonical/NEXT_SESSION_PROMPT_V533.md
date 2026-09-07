# NEXT_SESSION_PROMPT_V533.md — Start of V534

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js               # expect 131 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v533.test.js     # 13/13
```

## Convention שמור
- `node_modules/ws/index.js` — vendored stub. אל תגע.
- `node_modules/commander/index.js` — vendored stub. אל תגע.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.

## מצב ב-V533
- 533.0.0. `governanceDiagnose533` — dep visibility ל-heartbeatGovernanceBridge532.
- `GET /api/v1/diamond/heartbeat/governance/diagnose` → status per dep (ok/missing/degraded).
- 131 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V534

**חבר את diagnoseBridgeOpts533 לתגובת governance-state עצמה**

כרגע, `GET /api/v1/diamond/heartbeat/governance-state` (V532) מחזיר snapshot או sentinel.
אם `snapshotsFailed > 0` — ה-sentinel לא אומר *למה* זה נכשל.

המשימה:
1. הוסף middleware/wrapper שמזהה אם `snap.ok === false && snap.reason === 'not_started'` ו-`snapshotsFailed > 0`.
2. במקרה כזה — קרא ל-`diagnoseBridgeOpts533` והוסף `diagnose` לתגובה.
3. לחלופין: הוסף `GET /api/v1/diamond/heartbeat/governance/health` שמאחד stats + diagnose + state במבט אחד.

**כלל**: grep `governanceHealth\|healthEndpoint` קודם — אין כפיל, בטוח לבנות.

## שביר
- אל תשנה את ה-IIFE של V532 — הוא מחזיק singleton `_bridge532`.
- אל תמחק endpoints קיימים.
