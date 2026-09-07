# WRAPPED — עגוני-ערך צמודים על הדקס (Task 63)

> "תנסה להקים מטבעות צמודים על הדקס — wrapped — שנוכל לקבל ערך על ההזמנות
> והתנגדות לגרידים שלנו" — המפעיל, 2026-09-04

## מה נבנה

שכבת-עגונים ריבונית על אוטובוס-ה-saos (custom_json id="saos", חינם-RC,
חתימת-posting) עם פרוטוקול משלה: **saos.wrap/v1**. אפס תלות-צד-שלישי,
אפס עמלות-פריסה — רק השרשראות עצמן.

| נכס | עגן | גיבוי | מסילת-הגיבוי |
|---|---|---|---|
| **WSBD-1** | SBD 1:1 | 0.26 WSBD ← 0.26 SBD נעול (100%) | נעילה-עצמית (transfer אוצר→אוצר, ממו `saos:xlock:WSBD:<amt>:<ref>`) — נראה לעין על Steem עצמו, replay-מאומת |
| **PHIVE-1** | HIVE 1:1 (חוצה-שרשראות) | 0.001 PHIVE ← 0.001 HIVE נעול ב-Hive | transfer עצמי על Hive עם ממו `saos:xlock:PHIVE:<amt>`; ההנפקה על Steem נושאת את txid-הנעילה כראייה; פירעון: burn → פתיחת-נעילה |

## לכידת-ערך מההזמנות ("שנקבל ערך על ההזמנות")

- `pool_init` נושא **feeBps=30** — כל `pool_swap` גובה עמלה שנרשמת בפנקס:
  חצי ל-LP, חצי לאוצר. ההוכחה החיה: 2 swaps, fees 0.00012 (LP 0.00006 +
  אוצר 0.00006), fee-swap blk 109293910.
- הפנקס = השרשרת: הקונסולה עושה replay דטרמיניסטי של היסטוריית-האוצר
  (`/api/ops/saos/wrapped`) — כלומר העמלות, הספר והבריכות נגזרים מהשרשרת
  עצמה, לא מקבצי-מצב פרטיים.

## חוסן-גרידים ("התנגדות לגרידים שלנו")

- גריד רב-זוגי: SAOS:STEEM (Task 47) + **WSBD:STEEM** + **PHIVE:STEEM** —
  כל זוג עם עוגן-fair נמדד משלו (ספר-שוק-פנימי / שער-חוצה SBD÷HBD).
- שכבות-עומק נוספות: בריכת-AMM לכל זוג + הזמנת-maker על ה-DEX האמיתי
  של Hive-Engine (BEE, 5% מתחת ל-ask) שמקדמת את מדרגת ה-100 BEE →
  חוזה-SAOS פרטי על Engine (Task 61).

## ההולדה של WSBD-1 — שלוש מסילות אמיתיות (LIVE, 2026-09-04)

1. **הזמנת-limit בשוק-הפנימי** (STEEM→SBD) — חסומת-תקציב באותו-ערב
   (ראיות-כנות ב-evidence), המסילה מוכחת-מ-Task 59.
2. **סחיבת-צי**: 6 transfers חיים — macrame 0.015 · siq 0.124 · tov 0.045 ·
   wic 0.037 · wog 0.039 → האוצר (ynet דילוג-כנה: operator-delegated,
   אין-active). blk 109293552-564.
3. **נעילה-עצמית**: 0.26 SBD, txid 2d6ed4c0… (blk 109293564) →
   mint 0.26 WSBD + pool_init + pool_add (txid d18686dd…, blk 109293718).

## ארכיטקטורה

```
agent/wrapped.cjs          — מודול detached (דפוס-gitkeeper): --boot חד-פעמי
                             (idempotent-מול-השרשרת) + --beat תחזוקה
לולאה 24 wrappedCycle      — spawn + קריאת-state + updateLoop + STATUS.wrapped
src/lib/steem/wrapped.ts   — replay דטרמיניסטי (locks · mint/burn · book ·
                             pools · fees) + עוגני-מדידה חיים
/api/ops/saos/wrapped      — snapshot מלא + מראת-דמון (state לא-סודי)
WrappedCard (emerald)      — פאנל-חי במכונה
verify_system ×5           — WRAP-63 · XFEE-63 · XWRAP-63 · XENG-63 · LOOP-63
```

## תגליות-פרוטוקול חיות (ראיות — ידיעה-שלילית היא ראייה)

1. **get_account_history מוגבל-100/עמוד** בצמתים-ציבוריים (‏"upper limit is
   100") — סריקות חייבות pagination מדורג; חלק מהצמתים מאחזים את
   האינדקס בדקות-עד-שעות (‏steemit לפעמים ~12h).
2. **condenser_api.get_current_price_feed נדחה** (assert_exception) בצמתים
   ציבוריים — העוגן-הראשי = ספר-השוק (real_price); ה-median מ-get_feed_history
   = תחום-תבונה בלבד (ידוע-כישן: 0.1043 מול-ספר 0.0967).
3. **ה-Engine משתיק בשקט הזמנות-חורגות-מיתרה** — op על-השרשרת (3901e66d,
   3.42 BEE @ 0.577 ≈ 1.97 SWAP.HIVE כשהיתרה 1.81) ללא-הזמנה ב-buyBook
   וללא-חיוב-יתרה. לכן: תקציב-מחושב-מראש בלבד.
4. **broadcast מחזיר-txid גם-כשהעסקה לא-נחתה** (RC/TAPOS-drop אחרי-קבלה
   למאגר) — חובה אימות-נחיתה (get_transaction על צומת-עצמאי) לפני-רישום
   ראייה; העסקה-שלא-נחתה לא-עולה-כלום.
5. **שער-חוצה מדיד**: HIVE/STEEM = (SBD/STEEM)÷(HBD/HIVE) = 0.0967÷0.047
   ≈ 2.057 — עוגן-הדולר-המשותף עובד.
6. **חתימות**: custom_json-טהור = posting בלבד; שילוב-active-מיותר נדחה
   ("irrelevant signature included").
7. **Expiration** של limit_order_create: ISO בלי-milliseconds (bad lexical cast).
8. **idempotence מול-השרשרת**: refs ייחודיים (txid-נעילה) מונעים-נפיחות-גיבוי
   גם-אחרי-מנפק-כפול; burn מתקן-היצע (e0677289).

## גבולות-כנים

- הזמנת-maker על Engine: RC-חסום כרגע (19M < 150M שער) — ניסיון-אוטומטי
  בכל-beat, אפס-עלות.
- PHIVE נזילות-זעירה (0.001) — top-up אוטומטי כש-Hive נזיל ≥0.06
  (מכונת-hivePower ממשיכה להרוויח).
- קניית-ה-SBD בשוק-הפנימי נדחתה-הערב (ספר-זז) — הגיבוי נבנה מסחיבת-הצי;
  ההזרמה תמשיך ב-beats (sbd > locked → lock+mint אוטומטי).

## קפסולות-הוכחה

WRAP-63 ✓ · XFEE-63 ✓ · XWRAP-63 ✓ · XENG-63 (אדום-כנה עד-RC) · LOOP-63 ✓
— מטריצה 100/121.
