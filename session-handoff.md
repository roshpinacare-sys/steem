# session-handoff — מסירת-סשן (harness · r158)

**Last Updated:** 2026-10-03T01:30Z · **Current Objective:** הכנסה-אמת-מעל-$0.01/יום · **Recommended Next Step:** אחרי-02:01Z אמת-נחיתת-powerdown (census: withdraw_vesting+fuel-פריסה) · 04/10+ פרעוני-הקיורציה-הראשונים → שיוך-ROI-מנוע/חוץ (F-14) · אחרי-48ש' עקומת-VP-חושפת-חלון-השיא · טיק-מפעל-שכבת-תפקיד ~03:42Z.

> מטרה: כל סשן חדש עובד תוך דקות. עדכן בסוף-כל-סשן. אין סודות בקובץ זה.

## מצב-עתה (עודכן: 2026-10-02T23:10Z)

- **קומיט:** local==origin==(ראש-השרשרת-החי; תמיד אמת ב-init.sh). תמיד `git pull --rebase --autostash` לפני-עבודה — יש סשנים-מקבילים + עוגנים-אוטומטיים. **rebase-חשוף עתה נחסם-על-ידי-השער (git.race).**
- **צי-החיים (נמדד 22:37–23:07Z):** 3000 בית · 3034 money-mover (2,999 פעימות · 60ש') · 3038 fleet-verify · 3040 קיורציה · 3041 kpi-scribe · 3042 governance · 3043 treasury-audit · 3044 scout-market · 3045 business-engine (85 ticks) · 3046 מפעל-תוכן (12 ticks · 2 פוסטים · 12 הצבעות בפוסט-האחרון).
- **כוח-מחשב (r158):** לולאת-computer-use-חיה (see-verify: פתח→צלם→VLM→פסק-דין) · מפקד-יכולות-מהחי-+8-כלים-רשומים · אימוץ-מתועד מ-trycua/cua —
- **תיאום-VP (r157, אישור-מפעיל):** D-r157-VP-COORD-ביומן-ההחלטות · שיוך-פרעונים-להצבעות-ב-census (V2b) · עקומת-VP-שעתית-במצב-הקיורציה (votingPowerCurve) ·
- **הכנסה (מדודה-מהשרשרת · r156):** **מפקד-ההכנסות חי** (scripts/revenue-census.mjs · init.sh-4b): 4,286.123 SP-נטו (יחס-חי 1,613.31) · הכנסה-נמדדת-בחלון-9-ימים: 0 USD — **מבני-ומוסבר** (חלון-פרעון-7-ימים: הצבעות-27/09 משתלמות-מ-04/10, פוסטי-מפעל-02/10 משתלמים-מ-09/10) · **כותב-חוץ-על-החשבון נמדד: 146 הצבעות ב-42.3% ממוצע מול 32 של-המנוע (V1b)** — מתחרה-על-ה-VP (נמדד 57.92%) · מיקרו-גריד: PnL ממומש −1.119 SBD — הודק r151, מדידת-השפעה ~2026-10-09.
- **ריבונות-הסוכנים (r152→r154):** (1) ספריית-תפקידים — R1+R2 wired · (2) שער-ההרג sovereign-guard — selftest 60/60 · pre-commit · חסימות-מתועדות · (3) **הוכחת-הריבונות — PROVEN 9/9 מול Emergence World (מנוע רץ + init.sh סעיף 6)**.

## חסמים (blockers)

- **D-TREASURY** — שער-חתום-מוצהר: המלצת-הרשת v1 (saos1CKtm); ממתין-למילה-אחת-מהמפעיל ("v1" או "v0").
- **WEAVE_PUBLIC_URL** — נמדד: אין-בסיס-ציבורי-נגיש-בסביבה (:81/:3000 מבחוץ=timeout); דורש-דומיין-מהמפעיל.
- **דלק (B-1):** fuel.totalFuel=0 — אך **הפתרון-אוטונומי לגמרי (מנוסה בקוד):** תשלום-powerdown-ראשון **475.853 STEEM ב-2026-10-03T02:01:27Z** → totalFuel=נזיל+בפקודות−תביעה (route.ts:1142) → המוביל פורס-בתוך-מחזור (חוק-4, route.ts:804). שורת-ההרג 2026-10-16 — צפוי-להיפתר-לפניה.

## איך-להמשיך (next step ישר)

1. `bash init.sh` — עד-שהכל ירוק (tsc · eslint · צי-הפורטים · מפעל · קיורציה · **שער-ההרג**).
2. קרא progress.md (רשומה אחת אחרונה) + feature_list.json (active_feature + next_step של כל F).
3. בחר פתוח מהרשימה ב-progress.md או next_step חי-מ-feature_list.json.
4. לפני-פקודה-הרסנית: `bun scripts/sovereign-guard.mjs --check "<cmd>"` (חוק-קשיח ב-AGENTS.md).
5. בסיום: עדכן feature_list.json (ראיה!) → progress.md (רשומה-חדשה בראש) → קובץ זה → commit+push.

## קבצים-קריטיים (מפה-מהירה)

| מה | איפה |
|---|---|
| מצב-המפעל | sovereign/businesses/content-factory-state.json |
| מצב-הקיורציה | sovereign/curation/state.json |
| מצב-הכסף + PnL | sovereign/money/state.json · pnl-scan.json |
| רישום-העסקים | sovereign/businesses/registry.json · ONE-READ.md (למפעיל) |
| ספריית-תפקידי-מומחה | sovereign/agents/role-library.json (prompts.chat · r152) |
| שער-ההרג | scripts/sovereign-guard.mjs · sovereign/guard/blocked.jsonl+stats+selftest (r153) |
| הוכחת-הריבונות | scripts/sovereignty-proof.mjs · sovereign/bloc/EMERGENCE-scorecard.json · EMERGENCE-WORLD-roast.md (r154) |
| מארזי-הכרעה | sovereign/bloc/D-TREASURY-evidence.md · WEAVE_PUBLIC_URL-one-read.md |
| מפקד-ההכנסות + שיוך | scripts/revenue-census.mjs · sovereign/revenue/census.json (r156/r157) |
| עקומת-ה-VP | sovereign/curation/state.json → votingPowerCurve (r157) |
| כוח-מחשב (see-verify) | scripts/see-verify.mjs · sovereign/see/ (r158) |
| מפקד-יכולות+רישום-כלים | scripts/capability-census.mjs · sovereign/capabilities/ (r158) |
| יומן-העבודה המלא | worklog.md (append בלבד) |
| סודות (מקומי) | upload/pat.env · upload/headcorner.txt — לעולם לא בגיט |
