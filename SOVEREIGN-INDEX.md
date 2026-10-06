# SOVEREIGN-INDEX — מפת-האמת האחת (r155)

> **המפה-הזאת-מיוצרת-מהחי** — `bun scripts/sovereign-index.mjs` קורא-את-המכונות-וכותב-אותה. אסור-לערוך-ביד (עדכון-ידני = סטייה-מהאמת).
> נוצר: 2026-10-02T23:19:04.049Z · השער-הקנוני: `bash init.sh` · חוק-העבודה: `AGENTS.md`

## 1. צי-החיים — נמדד-בעת-היווצרות-המפה (10/10 חיים)

| פורט | שירות | מצב | מדידה |
|---|---|---|---|
| 3000 | הבית (SAOS · THE WEAVE) | ✔ חי | |
| 3034 | money-mover (דיבון-הכסף) | ✔ חי | beats=3011 |
| 3038 | fleet-verify (הנוטריון) | ✔ חי | |
| 3040 | curation (קיורציה) | ✔ חי | |
| 3041 | kpi-scribe | ✔ חי | |
| 3042 | governance | ✔ חי | |
| 3043 | treasury-audit | ✔ חי | |
| 3044 | scout-market | ✔ חי | |
| 3045 | business-engine | ✔ חי | ticks=123 |
| 3046 | content-factory (מפעל-התוכן) | ✔ חי | ticks=12 · posts=2 |

## 2. מפת-האמת — כל-תת-מערכת → מצבה → ראייתה → אימותה

| תת-מערכת | מצב-האמת | feature | אימות-שוטף |
|---|---|---|---|
| מפעל-התוכן (B-5) | `sovereign/businesses/content-factory-state.json` | F-1 | init.sh סעיף 4 |
| קיורציה | `sovereign/curation/state.json` | F-2 | init.sh סעיף 4 |
| דיבון-הכסף | `sovereign/money/state.json · pnl-scan.json` | F-3 | init.sh סעיף 3 |
| מנוע-עסקים B-1..B-5 | `sovereign/businesses/registry.json · ONE-READ.md` | F-4 | GET :3045/health |
| גיט-ריבוני + askpass | `sovereign/fleet-verify/state.json` | F-5 | init.sh סעיף 1 |
| ה-harness הקנוני | `feature_list.json · progress.md · session-handoff.md` | F-6 | init.sh סעיף 7 |
| צי-החיים | `10 פורטים (טבלה למעלה)` | F-7 | init.sh סעיף 3 |
| ספריית-תפקידים (prompts.chat) | `sovereign/agents/role-library.json` | F-9 | מדידת-r152 PASS |
| שער-ההרג (sovereign-guard) | `scripts/sovereign-guard.mjs · sovereign/guard/*` | F-10 | init.sh סעיף 5 |
| הוכחת-הריבונות (Emergence) | `scripts/sovereignty-proof.mjs · sovereign/bloc/EMERGENCE-scorecard.json` | F-11 | init.sh סעיף 6 |

## 3. ספר-ההישגים — מדוד, לא מוצהר

| הישג | המדידה |
|---|---|
| **רשת-ריבונית חיה** | 10/10 שירותים-חיים-עכשיו · 3011 פעימות-מוביל · 222 פעימות-קיורציה |
| **גלי-עבודה מתועדים** | 274 סעיפי-גל ב-worklog (5090 שורות) · 1826 קומיטים מאז 2026-09-14 |
| **הכנסה-על-השרשרת** | מפעל-תוכן: 2 פוסטים-אמת · אחרון: 12 הצבעות-חוץ · קיורציה 4,285 SP על 6% |
| **ממשל-מבוסס-ראיה** | 148 החלטות-חתומות ב-DECISION_LOG · כולן-עם-הצדקה-מדודה |
| **שער-ההרג (r153)** | guard: selftest 60/60 · 1 חסימות-מתועדות · pre-commit fail-closed |
| **הוכחת-הריבונות (r154)** | scorecard מול Emergence World: 9/9 PROVEN |
| **ה-harness (r151)** | 5 מערכות · אין-הכרזת-בוצע-בלי-שער-ירוק-וראיה · 11 features עם evidence_path |

## 4. פרוטוקול-העבודה-האחת (מקשה-אחת)

| שלב | חוק | היכן |
|---|---|---|
| פתיחה | `git pull --rebase --autostash` (rebase-חשוף נחסם-על-ידי-השער) → `bash init.sh` ירוק → קרא `SOVEREIGN-INDEX.md` + `session-handoff.md` | AGENTS.md |
| היקף | one-feature-at-a-time — `active_feature` יחיד | feature_list.json |
| פקודה-הרסנית | `bun scripts/sovereign-guard.mjs --check "<cmd>"` — exit 1 = חסום | AGENTS.md חוק-קשיח |
| סיום | feature_list (ראיה!) → progress → handoff → worklog → commit דרך-ה-guard → push | Definition of Done |

## 5. פתוחים-חיים (הקודקוד-המלא ב-progress.md)

1. **דלק (B-1)** — תשלום-powerdown-ראשון **2026-10-03T02:01Z** (475.853 STEEM); לאמת-פריסה-על-הסולם אחריו. שורת-ההרג 2026-10-16.
2. **D-TREASURY** — המלצה: v1 (saos1CKtm = נגזרת-האוצר; v0-גנזיס-ארכיון). ממתין-למילה-אחת-מהמפעיל — שער-חתום, אין-אוטונומיה.
3. **WEAVE_PUBLIC_URL** — נמדד: אין-בסיס-ציבורי-נגיש בסביבה (timeout-מבחוץ). נפתח-מחדש-כשהמפעיל-מכריז-דומיין.
4. **מדידת-התכנסות armBuy** — עוד ~7 ימים: אם ממוצע-קנייה לא ירד מתחת ממוצע-מכירה — הידוק-נוסף.
5. **טיק-המפעל-הראשון-עם-שכבת-התפקיד** — ~03:42Z; למדוד gate ואינגייג'מנט מול-הקודם.
6. **סריקת light-mode (r147-d2)** — ריפו-ה-Console-הציבורי (מחוץ-למאגר-הזה) — מיעוט-עדיפות.

---
*המקור: scripts/sovereign-index.mjs · נאכף-ב-init.sh סעיף 7 — כל-ריצה מתחדשת-מהמכונות.*
