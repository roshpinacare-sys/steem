# AGENCY-MAP W28 — קטלוג-הסוכנות-הריבונית (owner trace 1a15cc9fb5220725)

> "בחן כיצד ומה נוכל לנצל... תראה מה שאר הסוכנים גם עשו כדי שניישר קו ונפעיל הכל
> ושלא יהיו חסימות מיותרות... בחן תכנן בצע דחוף
> github.com/The-Swarm-Corporation/AutoHedge · github.com/msitarzewski/agency-agents"

## מה-נמדד ומה-אומץ (שני הריפו, shallow-clone /home/z/repos, מחוץ לכל-עץ-git)

| מקור | מה-שהוא | פסק-דין-פיזיקה | מה-אומץ-לדוקטרינה-שלנו |
|---|---|---|---|
| **AutoHedge** (The-Swarm-Corporation, MIT) | Python/swarm קרן-גידור-אוטונומית: Director→Quant→Risk→Execution, סולנה | **אין-אימוץ-runtime** (אותה-מחלקה-כמו Vibe-Trading W27-d: Python כבד בסנדבוקס-עוין-ריפר; וגם-דומיין-זר) | **הפורט-הדפוסי**: `mini-services/saos-engine/hedge-desk.mjs` (W28-b) — שערי `market_making.py` המאומצים (inventory-exposure / rebalance / min-profit) כשכבת-ייעוץ ילידת-איבר; **אפס-סמכות-חתימה** |
| **agency-agents** (msitarzewski, MIT) | קטלוג 200+ personas ב-18 divisions + runbooks.json (NEXUS) + מנגנון-התקנה | **אין-אימוץ-personas** (תיאטרון-דמויות אינו-ראיה) | **הצורה**: `agency/catalog.json` (מפת-התמצאות-עצמית לצי) + `agency/runbooks.json` (6 תרחישים נמדדים) + `agency/verify.mjs` (מאמת-חיות כנה) |

## איך-משתמשים (לכל-סוכן-חדש — חובה-לפני-תנועה-ראשונה)

```bash
# 1. קרא את מפת-הערוצים (מי-עוש-מה, מי-רשאי-לכתוב-למה)
jq . agency/catalog.json

# 2. מדוד חיות-בפועל (כנה: CI lanes נשפטים על-ידי-הקבלות-שלהם, לא-מזויפים)
bun agency/verify.mjs   # exit 0 = כל-ה-ports UP

# 3. תרחיש? הרץ את-ה-runbook שלו (wipe / divergence / engine-reload / hot-market / FF / custody)
jq -r '.runbooks[] | .slug' agency/runbooks.json
```

## החוקים-שהקטלוג מקבע

1. **R343 additive-only** — אף-סוכן-לא-מוחק-רישום-של-אחר.
2. **R322** — סודות רק בכספת; הקטלוג מחזיק-מצביעים, לעולם-לא-חומר.
3. **W28-coordination** — לפני-עבודה: worklog-זנב + catalog; אחרי: W-entry; אף-ערוץ-לא-כותב-לערוץ-אחר.
4. **HD_LAW (W28-b)** — שולחן-הגידור ייעוץ-בלבד לנצח; ההכרעה נשארת בשרשרת-השומרים (T2/G41/VF1/RC).

## יישור-הקו-עם-הצי (נמדד 2026-10-21, origin log)

- **agent-2-economy-core**: vault-seal/vault-sync רצים (W119 probes על אטימות-היסטורית) — אין-התנגשות: הם-custody, אני-שוק+סיכונים+קטלוג.
- **saos-custody-lane**: army-active-custody probe/rotate כל-כמה-דקות — 0/9 החזקות-ACTIVE (נאמנות-owner; המסילה-חמושה).
- **roshpinacare-sys**: beat verdicts (state via API last-mile) — הפעימה-החיה.
- **G43 MANY-HANDS** (5bad48068): גוף-אחד-הרבה-ידיים — manyhands.mjs חי במנוע; hedge-desk משלים אותו בשכבת-הסיכון, לא-מתחרה.
- **R561** (1bd4df7b4): חוק-הצומת-הריק (EMPTY-RC NODE-DEFECT) — נקלט בעץ-אחרי-היישור.

## החסימות-שחוסלו ב-W28

1. **מסילת-הדחיפה** (non-fast-forward, ahead 7/behind 59, custodian div=127-עקב-מחלה-קודמת) → ריקוד R300/R302 (W28-a) → SYNCED 0/0, div-exit=0.
2. **G6 חסם 4 מחיקות-פנטום** (קבצי-origin שעץ-ה-wipe מעולם-לא-גילם) → הוחזרו; אובדן-זנב-receipts שוחזר ב-union מגיבוי-tar (33 פנקסים).

## מה-עוד-ממתין (לא-חסימה — חוק-המתנה)

- **FF**: PENDING-ACTIVATION (probe 5+, קוד 501) — ה-owner ציווה לחכות לאישורם; promote-מדורג חמוש.
- **Power-up**: נשאר נדחה בשער-החתימה (חוק-נזילות W23-a לא-בוטל על-ידי 'הפעל-הכל' — נזילות-קודמת).
- **Army ACTIVE keys**: 0/9 — חומר-owner בלבד (R327 נאכף).
