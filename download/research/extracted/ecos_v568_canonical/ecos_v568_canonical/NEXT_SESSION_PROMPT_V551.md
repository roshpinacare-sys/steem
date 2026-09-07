# NEXT_SESSION_PROMPT_V551.md — Start of V552

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js           # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
NODE_ENV=test node tests/v551.test.js              # 22/22
node scripts/audit-tests.js                       # ≥149 pass / 19 cannotRun / 0 realFail
```

## Convention שמור
- `node_modules/ws`, `commander` — vendored stubs, אל תגע.
- selfExcludes בטסטים: `v510, v528, v534` — circular audit loop, שמור.
- audit-tests.js דורש שתי ריצות רצופות להתייצב.

## מצב ב-V551
- 551.0.0. `executePlan437` מוגן דרך `dispatchBridge550 → gatePlan549`.
- guard467 + bridge466 מגולים בגייט בכל executePlan437.
- `authorized=true` + ניקוד policy נמוך → `MANUAL` (fail-closed). זו ה-design הנכונה.
- 149 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V552

**חשוף את `_patchStats551` דרך `/api/v1/dispatch/patch/status` ואמת שניקוד policy מתאפשר**

הבעיה: gate549 תמיד מחזיר MANUAL כי הניקוד = 0 (אין signals). צריך לחבר signals אמיתיים.

המשימה:
1. בדוק `lib/orchestratorPolicyGate549.js` — מה מייצר ניקוד גבוה מ-0.7 (AUTO)?
2. הוסף endpoint `POST /api/v1/dispatch/gate/test` שמריץ `gatePlan549` עם plan פשוט + signals מוגדרים → מחזיר `{ decision, score, signals }`.
3. אם הבעיה היא שהsignals לא מוחלפים ל-gate: הוסף `scoreOverride` ב-ctx של ה-IIFE (לbenchmark בלבד, fail-closed ב-prod).

**כלל**: `grep gatePlan549 lib/` לפני בנייה. SACRED לא לגעת. exit 0 + 0 realFail לפני אריזה.
