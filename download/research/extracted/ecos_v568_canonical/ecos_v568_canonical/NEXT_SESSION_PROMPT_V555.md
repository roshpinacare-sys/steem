# NEXT_SESSION_PROMPT_V555.md — Start of V556

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js           # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
NODE_ENV=test node tests/v555.test.js              # 12/12
NODE_ENV=test node tests/v554.test.js              # 14/14
node scripts/audit-tests.js                       # 153 pass / 19 cannotRun / 0 realFail
```

## Convention שמור
- `node_modules/ws`, `commander` — vendored stubs.
- selfExcludes: `v510, v528, v534` — circular audit loop.
- `trendSeedBridge553` — boot seed מופעל פעם אחת. אל תכפיל.

## מצב ב-V555
- 555.0.0. **הבאג ב-`_readTrend546` תוקן**: `r.trend` → `r.direction` (lib + src/lib).
- עכשיו `policy.trend` מחזיר `'stable'` אחרי seed, לא `'unknown'`.
- `gateEvaluateBridge554` עדיין פועל ומשתמש בתיקון הישיר (כחלופה, עדיין תקף).
- 153 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V556

**חבר את policy546.trend לתגובת gate/evaluate (V554)**

כרגע `GET /api/v1/deep-health/gate/evaluate` (V554) מחזיר `decision` + trend שקרא בעצמו.
אחרי תיקון V555, `policy546.getPolicy546()` עכשיו יכול לשמש כmصدر-האמת.

משימה: עדכן `evaluateGate554` (או הוסף field) שיכלול `policyTrend: policy546.getPolicy546().trend`
בתגובה — כדי שצרכן יוכל להשוות בין `gateTrend` ל-`policyTrend` ולדעת אם הם מסכימים.

**grep לפני**: `grep -r "evaluateGate554\|policyTrend" lib/ tests/` — אם לא קיים, בטוח.
**כלל**: IIFE חדש ב-V556-T01, אל תגע ב-IIFE של V554.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-556. tests/v556.test.js exit 0 → zip.
