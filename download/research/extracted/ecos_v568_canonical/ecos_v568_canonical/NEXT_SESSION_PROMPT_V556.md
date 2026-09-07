# NEXT_SESSION_PROMPT_V556.md — Start of V557

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js
node --check ecos-api-server.js
NODE_ENV=test node tests/v556.test.js    # 12/12
node scripts/audit-tests.js             # 154 pass / 19 cannotRun / 0 realFail
```

## Convention שמור
- `node_modules/ws`, `commander` — vendored stubs. אל תגע.
- selfExcludes: `v510, v528, v534` — circular audit loop.
- `trendSeedBridge553` — boot seed פעם אחת. אל תכפיל.
- IIFE של V554 (gateEvaluateBridge) ושל V532 (_bridge532) — אל תגע.

## מצב ב-V556
- 556.0.0. `gatePolicyTrendBridge556` — מחזיר `policyTrend`, `trendAgreement` ב-gate/evaluate.
- עם seed: `trendAgreement: true` (gate+policy מסכימים).
- 154 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V557

**העבר את `/api/v1/deep-health/gate/evaluate` ל-V556 enriched**

כרגע קיימים שני endpoints:
- V554: `GET /api/v1/deep-health/gate/evaluate` — trend בלי policy
- V556: `GET /api/v1/deep-health/gate/evaluate/v556` — enriched

אבל V554 עדיין ה-"ראשי". V557 יכול להוסיף middleware/wrapper שמגיב על הpath הישן עם enriched output.

**אבל**: אסור למחוק את ה-V554 endpoint. במקום זה — הוסף `GET /api/v1/deep-health/gate/evaluate/latest` שנותב ל-V556.

**grep לפני**: `grep "/deep-health/gate/evaluate" ecos-api-server.js | head -10`

חלופה טובה אם זה קיים: בדוק `deepHealthOrchestrator` — האם קיים endpoint שמאחד את כל deep-health בנוף אחד.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת. כל מזהה מסתיים ב-557.
