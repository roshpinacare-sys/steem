# NEXT_SESSION_PROMPT_V559.md — Start of V560

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js
node --check ecos-api-server.js
node scripts/audit-tests.js   # 157 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v559.test.js   # 12/12
```

## Convention שמור
- `tests/v497.test.js`: `libCount < 645`. לא להוסיף lib modules ללא עדכון threshold.
- selfExcludes: v510, v528, v534 — circular audit loop.
- V557 IIFE: `U558_557` soft-require. fallback ל-V556 נשמר. אל תמחק fallback.
- `/latest` → `v558-unified`. עם כל שדרוג עתידי עדכן `routedTo`.

## מצב ב-V559
- 559.0.0. `/latest` ↔ V558 unified. `trendAgreement` מובטח boolean (לא null).
- V554 + V556 + V557/latest + V558/status + V559/latest/v559 — כולם פעילים.
- 157 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V560

בדוק אם `gateScore` חוזר `null` (מ-`getCompositeScore543`):
```bash
node -e "const U=require('./lib/deepHealthUnifiedStatus558.js'); const r=U.getUnifiedStatus558(); console.log('gateScore:', r.gateScore);"
```

אם `null` → בדוק `getCompositeScore543`:
```bash
grep -n "module.exports\|getCompositeScore" lib/deepHealthCompositeScore543.js | head -10
```

V560: חבר `getCompositeScore543` ל-`getUnifiedStatus558` כדי ש-`gateScore` יהיה מספר אמיתי.
