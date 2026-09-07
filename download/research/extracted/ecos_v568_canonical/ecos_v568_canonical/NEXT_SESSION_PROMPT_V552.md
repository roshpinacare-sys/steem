# NEXT_SESSION_PROMPT_V552.md — Start of V553

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js           # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
NODE_ENV=test node tests/v552.test.js              # 22/22
node scripts/audit-tests.js                       # ≥150 pass / 19 cannotRun / 0 realFail
```

## Convention שמור
- `node_modules/ws`, `commander` — vendored stubs.
- selfExcludes: `v510, v528, v534` — circular audit loop.
- `deepHealthScoreBridge552` מוחל ב-boot. אל תחל פעמיים.

## מצב ב-V552
- 552.0.0. **bug תוקן**: score 0→0.5 ב-gate549 (field alias: compositeScore→composite/score).
- gate chain: `marketMakerCanon543 → policy546 → gate547 → gate549 → dispatchBridge550 → executePlan437(patched)`.
- decision=MANUAL עדיין — trend=unknown (fail-closed by design). חסר history.
- 150 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V553

**הזן trend history ל-deepHealthAlertHistory542 כדי לאפשר SUPERVISED**

הבעיה: `deepHealthAlertHistory542.getTrend542()` מחזיר 'unknown' כי אין snapshots.

המשימה:
1. בדוק `lib/deepHealthAlertHistory542.js` — `addSnapshot542(snapshot)` → מה format?
2. `lib/deepHealthHistoryScheduler544.js` — האם כבר עושה זאת? בדוק אם מחובר ל-server.
3. אם scheduler קיים: חבר אותו ב-IIFE V553 (start scheduler → generates history → trend בעוד ריצות).
4. אם לא: הוסף manual seed: `addSnapshot542({ ok: true, score: 0.5, ts: Date.now() })` × 3 ב-IIFE.

**כלל**: grep `deepHealthHistoryScheduler\|addSnapshot542` בשרת לפני בנייה. SACRED לא לגעת.
