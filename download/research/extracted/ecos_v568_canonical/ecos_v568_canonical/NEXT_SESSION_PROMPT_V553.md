# NEXT_SESSION_PROMPT_V553.md — Start of V554

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js           # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
NODE_ENV=test node tests/v553.test.js              # 16/16
node scripts/audit-tests.js                       # ≥151 pass / 19 cannotRun / 0 realFail
```

## Convention שמור
- `node_modules/ws`, `commander` — vendored stubs.
- selfExcludes: `v510, v528, v534` — circular audit loop.
- `deepHealthScoreBridge552` מוחל ב-boot. אל תחל פעמיים.
- `trendSeedBridge553` — boot seed מופעל פעם אחת. אל תכפיל.

## מצב ב-V553
- 553.0.0. Ring buffer נזרע ב-boot (10 pushes). getTrend542() → 'stable' (לא unknown).
- Boot seed: seeded=10, trend=stable. scheduler attach עדיין false (heartbeat לא פועם).
- gate chain: `marketMakerCanon543 → policy546 → gate547 → gate549 → dispatchBridge550`.
- decision עדיין MANUAL עד שיש heartbeat. trend=stable פותח את השלב הבא.
- 151 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V554

**חבר את הtrend ל-gate549 ישירות — הרץ gate evaluation עם trend אמיתי**

כרגע gate549 מקבל trend='unknown' כי הוא קורא ישירות להיסטוריה, לא דרך seed.
אחרי boot seed ב-V553, getTrend542() מחזיר 'stable'. gate549 צריך לדעת זאת.

```bash
# בדוק כיצד gate549 קורא ל-getTrend542:
grep -n "getTrend\|trend" lib/deepHealthPolicyGate549.js | head -20
# בדוק אם getSnapshot בbridge532 כולל trend:
grep -n "trend\|getTrend" lib/heartbeatGovernanceBridge532.js | head -10
```

משימה:
1. אם gate549 קורא ישירות ל-`getTrend542()` — הוא כבר יקבל 'stable' אחרי boot seed.
   → הוסף endpoint `GET /api/v1/deep-health/gate/evaluate` שמחזיר evaluation עם trend הנוכחי.
2. אם gate549 קורא דרך bridge snapshot — ייתכן שה-snapshot ישן. הוסף refresh.
3. בדוק: מה decision מחזיר gate549 כאשר trend='stable' (לא 'unknown')?

**כלל**: grep `gate/evaluate\|gateEvaluate` לפני בנייה. SACRED לא לגעת.
