# NEXT_SESSION_PROMPT_V557.md — Start of V558

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js
node --check ecos-api-server.js
node scripts/audit-tests.js             # 155 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v557.test.js   # 12/12
```

## Convention שמור
- `node_modules/ws`, `commander` — vendored stubs. אל תגע.
- selfExcludes: `v510, v528, v534` — circular audit loop.
- `trendSeedBridge553` — boot seed פעם אחת. אל תכפיל.
- `/latest` → V556. עם כל שדרוג evaluate חדש — עדכן את `routedTo` ב-V557.

## מצב ב-V557
- 557.0.0. `/latest` alias יציב → V556 enriched (policyTrend + trendAgreement).
- V554 + V556 + V557/latest קיימים. 155 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V558

**`trendAgreement` תמיד מחזיר null** — כי `trendSeedBridge553` לא נקרא בתחילת הגרסאות.

```bash
grep -n "trendSeedBridge553\|seedTrend553\|boot" ecos-api-server.js | head -10
```

בדוק אם `seedTrend553()` נקרא אי-פעם ב-IIFE. אם לא —
V558: הוסף קריאת boot-seed ב-IIFE (lazy, non-fatal) כך שה-`/latest` יחזיר `trendAgreement: true`.

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת. כל מזידנ מסתיים ב-558.
