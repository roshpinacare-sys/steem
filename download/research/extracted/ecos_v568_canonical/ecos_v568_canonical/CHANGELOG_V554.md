# CHANGELOG_V554.md — ECOS V554

## תאריך: 2026-06-05 | Phase P322 | Author: AI (Sonnet 4.6)

## מה זוהה — באג קריטי
בדיקה אמפירית לפי הוראות V553 NEXT_SESSION גילתה:

```
getTrend542() → { direction: 'stable', delta: 0, ... }   ← שדה: 'direction'
_readTrend546():  r.trend  → undefined → 'unknown'        ← שדה שגוי!
```

`deepHealthPolicy546._readTrend546()` מחפש `r.trend` — שדה שאינו קיים.
`getTrend542()` מחזיר `r.direction`. אי-התאמה גרמה ל-policy לראות תמיד `trend='unknown'`
→ decision=MANUAL לנצח, גם אחרי boot seed של V553.

## מה נבנה (פעולה E — Fix + Connection)
- **`lib/gateEvaluateBridge554.js`** + **`src/lib/gateEvaluateBridge554.js`** (זהים):
  - `evaluateGate554()` — קורא `getTrend542().direction` (שדה נכון), קורא score מ-canon543, קורא `_decide546` ישירות.
  - fallback inline כאשר `_decide546` לא זמין.
  - fail-closed: trend='rising'|'unknown' → MANUAL.
  - `patchNote` מתעד את תיקון המפתח.

- **IIFE בשרת**: `GET /api/v1/deep-health/gate/evaluate`, `GET /api/v1/admin/summary/v554`.

- **טסטים מתעדים את הבאג** (v554 test שורות "Bug documentation") — המקבילה של regression test.

## תוצאות אימות
- `node tests/v554.test.js`: **14/14 passed, exit 0**.
- `node scripts/audit-tests.js`: **152 pass, 19 cannotRun, 0 realFail** (לפני: 151/19/0).
- SACRED md5: ✓. `node --check`: ✓.

## מה לא אומת
- 19 cannotRun (vitest/ESM).
- policy546 עצמו לא תוקן — הבאג קיים שם. V555 יכול להגיש patch ל-policy546 אם מאושר.
- evaluateGate554 end-to-end עם marketMakerCanon543 אמיתי לא נבדק (score=0 בסביבה זו).
