# CHANGELOG_V557.md — deep-health/gate/evaluate/latest alias

## מה זוהה
NEXT_SESSION_PROMPT_V556 הצביע על אי-עקביות: V554 נשאר ה-endpoint "הרשמי" אבל V556 הוא הגרסה המעשירה. אין דרך לצרכן לקבל את ה-enriched output בלי לדעת את מספר הגרסה.

## מה נבנה
**V557 IIFE בשרת בלבד** — אין מודול lib חדש:
- `GET /api/v1/deep-health/gate/evaluate/latest` — alias יציב שתמיד מנתב לגרסת ה-evaluate המעשירה ביותר (כרגע V556). תגובה כוללת `routedTo: 'v556'`, `latestAlias: true`.
- V554 + V556 — **לא נגעת**, לא נמחקו.

## ניתוב
```
/deep-health/gate/evaluate         (V554 — legacy, unchanged)
/deep-health/gate/evaluate/v556    (V556 — enriched, unchanged)
/deep-health/gate/evaluate/latest  (V557 — always routes to most enriched)
```

## תוצאות אימות (לפני → אחרי)
| | לפני | אחרי |
|-|------|------|
| pass | 154 | **155** |
| cannotRun | 19 | 19 |
| realFail | 0 | **0** |

## מה לא אומת
19 cannotRun (vitest/ESM). `trendAgreement` מחזיר `null` כל עוד trend seed לא נטען — מכוון.
