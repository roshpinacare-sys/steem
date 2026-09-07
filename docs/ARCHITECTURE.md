# SAOS — הארכיטקטורה ההנדסית המלאה (המערכת החיה)

> עדכון: Task 51 · המערכת החיה (לא סימולציה) — מה שרץ עכשיו על Steem+Hive אמיתיים.
> העיקרון: **הריצות אצלנו (אפס-RC/תלות), השרשרת = שכבת-חתימה+עיגון+כלכלה.**

---

## 1. מפת-השכבות

```
┌────────────────────────────────────────────────────────────────────┐
│ SAOS Console (Next.js 16 · RTL · / = src/app/page.tsx)             │
│ 8 מסכים: פיקוד · כספים · ידע · מערכת · תוכניות · רשת · נזילות · גישה │
└──────────────▲─────────────────────────────▲──────────────────────┘
               │ /api/ops/* (poll)            │ exec-whitelist
┌──────────────┴─────────────────────────────▼──────────────────────┐
│ API layer (App Router routes — src/app/api/ops/**)                 │
│ agent/exec (whitelist+cooldown) · sovereign/{rc,cross} · liq ·     │
│ employment · net · saos/dex · brain · tx · proofs · daemon-log     │
└──────────────▲────────────────────────────────────────────────────┘
               │ spawn detached → result JSON files
┌──────────────┴────────────────────────────────────────────────────┐
│ agent/agent.cjs — הדמון (Node CJS, חי 24/7)                        │
│ 28 לולאות (למטה) · כספת מפתחות · שידורי steem-js/dhive · RC-gates  │
└───────┬──────────────────────────┬────────────────────────────────┘
        │ steem-js (Steem)          │ dhive/steem-js-chain-swap (Hive)
┌───────▼──────────┐      ┌────────▼─────────┐   ┌────────────────┐
│ STEEM (mainnet)  │      │ HIVE (mainnet)   │   │ Hive-Engine    │
│ אוטובוס id=saos  │      │ עוגני-גשר + שרדים│   │ (ssc, טוקנים)  │
└──────────────────┘      └──────────────────┘   └────────────────┘
```

---

## 2. זהויות ומפתחות (כספת)

- **האוצר**: `@headcorner` — מפתח-אחד שליטה-מלאה על **Steem + Hive** (אותה secp256k1, פרה-פורק 2018) + נגזרת-EVM `0x299D…915A` (חתימה על אותו סוד).
- **הצי**: 10 חיילי-אופרטור (`cashmachine, haran, lsa, macrame, siq, tov, wic, wog, woq, ynet`) — כל אחד **דו-שרשרתי מלא** (owner/active/posting/memo בשתי השרשראות; **ב-Task 51 הם חתמו ראשונה על Hive**).
- **כספת**: `agent/keys/vault.json` (git-ignored) — פורמט: `{accounts:[{username, tier, mode, keys:{posting:{wif,pub},...}, chains:{steem:[...], hive:[...]}}]}`.
- **מפעל דור-שני** (`factory_v2.cjs`): מפתחות **דטרמיניסטיים** מ-`FACTORY_MASTER` (agent/.env) + **עוגן-חילוץ** (headcorner בסמכות-owner של כל בוט, threshold 1) + גיבוי-כפול → מפתחות לא אובדים (התרחיש hcnova1-הזומבי מונע מבנית).
- **חוק**: WIF לעולם לא ב-git/לוגים; `sanitize()` מסנן WIF-דמויים מכל שורת-לוג.

## 3. אוטובוס-saos — פרוטוקול ה-State Machine שלנו

`custom_json id="saos"` · `{protocol:"saos/v1", action, ...}` — ה-DEX, הטוקן, ה-KV, השרדים, הפינגים — הכל על אוטובוס אחד חתום. Actions מיושמים:

| action | מה עושה | מאמת |
|---|---|---|
| `mint/burn/transfer` | ספר SAOS-1 (supply נגזר מההיסטוריה) | replay |
| `order/cancel/fill` | ספר-הזמנות (oid/side/price/amount) + fills | replay מלא |
| `pool_init/add/swap/remove` | בריכת-AMM (x·y=k, feeBps≤1000, LP shares) | replay + k |
| `fleet_ping` | פעימת-צי ריבונית (רוטציה 20 דק') | get_transaction |
| `shard` | **פיצול-שרדים בין-שרשרתי** (Task 51) | sha256 root |
| `perf`/`perf_probe` | עיגון מדידות-ביצועים | digest on-chain |
| `saos_result` | תוצר-משימה חתום-חייל → משכורת | payroll rail |

## 4. הדמון — 28 הלולאות

`claim · watcher · transferWatch · curation · factory · empire · dexMm · armyClaim · armyCuration · armySweep · fleetPace · netTask · gitkeeper · wrapped · microdex · yield · merchant · saosnet · anchor · paymaster · reflex · hivePower · genesis · commandBus · worldlog · fleetSell · liq · valueLock`

מרכזיות:
- **dexMm** (~10 דק'): מצטט סביב מחיר-הוגן **מעוגן-כושר-פירעון** (floor=אוצר-נזיל÷היצע; מגן-שער feed 0.005–10) · תקציב-פעימה 5 custom_json · ארביטראז' בריכה↔ספר (dev≥5%) · retry×3 backoff.
- **liq** (15 דק'): מסילת-חיילים סגורה — עודף-STEEM→escrow (memo `saos:escrow`)→קרדיט→SAOS→pool_add. caps: 0.03/חייל, LP-grants 3/פעימה.
- **bridge**: כל פעולה מועגנת על Hive **דרך ראוטר-הצי (53)** — rc_api פר-חייל, מיון, שידור דרך החייל-הבריא (האוצר רק פולבק — הסף-הקשה הוסר); proof-of-reserve checkpoints נוסעים על מפתחות-חיילים.
- **valueLock** (45 דק', Task 53): 25% מ-SAOS נזיל-אוצר (cap 3) → pool_add → **pool_lock 100%** — LP נעול-לצמיתות (מרוויח-עמלות, בלתי-נשלף) · מניפסט נעוג-על-Hive-דרך-הצי — ״ערך-מהתזוזות-נעול-בבריכות״.
- **genesis** (45 דק'): מדרגת-ערך — מכירות-נזילות→SWAP.HIVE→HIVE→BEE; ב-100 BEE: יצירת-SAOS-on-HE ג'נזיס (precision 3, maxSupply 1e9, issue 1M, staking/market).
- **fleetPace** (20 דק'): חייל אחד ברוטציה חותם fleet_ping במפתח-שלו + fee-routing לבריכה.
- **saosnet**: פעימת-השרשרת-הריבונית — כל-טענה→בדיקה→ראיה→**בלוק על SAOS-NET** (validators/rotation/checkpoints/stateRoot) · verify-15 נחתם height 90→93.
- **fleetSell** (20 דק', Task 74): רוטר-צי לפעולות-HE — שלבים-נשמרים idle→transferred→bought→done · רגל-תקועה מסתיימת בריצה-הבאה, לעולם לא חוזרת.
- **hivePower**: מכונת-מצב SWAP.HIVE→withdraw→HIVE→powerup→HP (הריבונות-החנוקה של Hive-RC) עם למידת-וריאנט.
- **worldlog**: שרשור-האש seq/prev + פריטה כפולה Steem↔Hive (Hive דרך ראוטר-הצי).
- **ממסר-מפל** (cascade.cjs, exec-חי): החלטה-אחת → 3 חתימות מקבילות (אוצר-Steem + חייל-Steem + חייל-Hive) · אימות-פר-שרשרת (סריקת-בלוק ב-Steem, get_transaction ב-Hive) — ×2 allVerified.

## 5. ה-DEX הכפול שלנו

1. **ספר-פקודות** על אוטובוס-saos (ריפליי דטרמיניסטי מההיסטוריה — `src/lib/steem/saos-dex.ts`).
2. **בריכת-AMM** על אותו אוטובוס — pool contract (Task 47): עמלות 30bps מצטברות לעתודות (ה-LP מרוויח), שיתוף פרו-רטה, ה-STEEM-leg = קרדיט-DEX (escrow) — **כושר-פירעון נמדד תמיד**.
- **עיגון-המחיר**: floor = אוצר-נזיל÷היצע; fair = max(floor, min(engine, floor×3)) — התיקון לפריצת-ה-1551.
- **Task 51**: מנוע-שידור-חוזר **עצמאי שני** (rebuild.cjs) שיחזר את כל העולם מההיסטוריה הציבורית — **11/11 התאמות** מול השרת (ספר, בריכה, יתרות, עמלות, trades).

## 6. ריבונות-RC וביצועים (Task 50–51)

- **החוק שנמדד**: חשבון-יחיד = 5 custom_json/בלוק; RC=f(SP), רג'ן 5-ימים; op-קומפקטי ≈54.9M RC → צי ≈3,200 ops/יום קיים-עצמי.
- **מטח-צי**: 16 ops/בלוק מ-4 חותמים (×3.2 מעל החומה, מאומת בבלוק 109271747); תקרת-צי 40/בלוק.
- **דחיסה**: 40 ריצות-מנוע → עיגון-אחד (×10); הריצות במנוע-מקומי — **449,065 ops/sec ב-2µs/op, אפס-RC** (נמדד Task 51).
- **חבירה-לבלוק**: ~3.1s בשתי השרשראות (נמדד Task 51 בשידור-חי).
- **פיצול-שרדים**: אובייקט-מצב 3,556B → 6 שברים (3 Steem + 3 Hive, 6 חותמים) → הרכבה מההיסטוריה הציבורית של שתיהן, **sha256 match**. אף שרשרת לא מחזיקה את האובייקט לבדה — המצב שלנו גבוה מכל רשת, וחומת-8192B נפרצת פי-N.

## 7. משכורות וכלכלה

- **payroll**: משימה-מאומתת (saos_result חתום-חייל) → 0.004 STEEM עם memo `saos:pay t_*` (cap 0.12/יום, רצפת-אוצר 0.1). התשלום הראשון חי (txid f71f23c2…).
- **fuel-line (Task 49)**: 50 SP לכל-חייל (delegation, txid 7757fc33…, ביטול-אוטומטי-אחרי-7-ימים להחזרת-ריבית) + הון-חוזר 0.03 STEEM לחייל — **תעסוקה 10/10**.
- **he-ladder**: סולם-גיוס-הון — מכירת-ארנק-HE ל-bids חיים → SWAP.HIVE (VKBT/CENT עברו on-chain; היתר RC-gated וממתין רג'ן).

## 8. הקונסולה (מוצר)

- `/` = Console 8 מסכים (RTL מלא, shadcn/ui, mobile 390 ✓).
- כל כרטיס = נתונים-חיים מקבצי-result של ריצות-אמיתיות + כפתורי-exec (whitelist, cooldown).
- **כרטיס 51** (`CrossSovereignCard`): שברי-המצב עם חותמים-פר-שרשרת, עולם-מהשרשרת, מנוע-אפס-RC, עוגן-ביצועים.

## 9. הפרדת-הרשויות (למה זה בטוח)

1. **exec-whitelist** — ה-API לא מריץ כלום שלא נרשם מראש; cooldown פר-סקריפט; `real:true` נדרש לשידור-חי.
2. **proof-gate** — כל באדג' בקונסולה נובע מקובץ-תוצאה של ריצה-אמיתית; ה-verifier מריץ **get_transaction עצמאי** על ה-txids לפני שהוא צובע ירוק.
3. **RC-gates פנימיים** — הדמון מדלג בכנות (status=throttled) במקום לשרוף-דלק; שערים מונעים מלחמות-משאבים בין-המערכות-שלנו.
4. **Solvency** — כל קרדיט-DEX של משתמש נספר מול האוצר-הנזיל בכל קריאת-סנאפשוט.

## 10. מה לא עובד עדיין (כנות)

- **Blurt**: כל הצמתים בלתי-נגישים מהרשת הזו (צומת-העל פגום) — מדוד ומתועד.
- **Hive-RC של האוצר**: 0.5% (53 עוגני-גשר שרפו) — מכונת-hivePower חיה ומתקנת אוטונומית; החיילים (2.1G RC כ"א) כבר נושאים מהצד-של-Hive.
- **GENESIS/CONTRACTS**: ממתינים ל-100 BEE / לרג'ן — הדמון מריץ אותם לבד כשיש דלק.
