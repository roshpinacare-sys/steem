# NEXT_SESSION_PROMPT_V558.md — Start of V559

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js
node --check ecos-api-server.js
node scripts/audit-tests.js   # 156 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v558.test.js   # 12/12
```

## Convention שמור
- `tests/v497.test.js`: libCount < 645. אם מוסיפים lib modules נוספים — עדכן threshold.
- selfExcludes: v510, v528, v534 — circular audit loop.
- `_ensureSeed558()` — lazy, non-fatal. אל תקרא כפול.
- `deepHealthUnifiedStatus558.js` — lib/ + src/lib/. אל תשנה ל-in-server-only.

## מצב ב-V558
- 558.0.0. `GET /api/v1/deep-health/status/v558` מחזיר `trendAgreement: true/false` (לא null).
- lazy-seed: אם ring buffer ריק → seedTrend553(10) אוטומטית.
- 156 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V559

**חבר `/latest` (V557) ל-unified (V558)**

כרגע V557's `/latest` נותב ל-V556 (שעלול להחזיר `trendAgreement: null`).
V559 יעדכן `/latest` לנתב ל-`getUnifiedStatus558()` — כך שה-alias תמיד מחזיר תוצאה מלאה.

```bash
grep -n "routedTo.*v556\|B556_557\|evaluate/latest" ecos-api-server.js | head -5
```

שיטה: עדכן V557 IIFE לשאוב מ-`deepHealthUnifiedStatus558` במקום `buildEnrichedEval556`.
הוסף `routedTo: 'v558-unified'` ל-response.
כל מזידן מסתיים ב-559. tests/v559.test.js exit 0 → zip.
