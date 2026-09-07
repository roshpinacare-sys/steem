# TFA — Trust-Integrity Roadmap (canonical, agent-facing)

> **מקור-האמת למצב-הקוד הוא תמיד `MANIFEST.md`.** המסמך הזה הוא **כיוון-מוצר ובקלוג**
> לשכבת trust-integrity (יושרת-היומן והוכחות-האמון), לא דיווח-מצב. אם משהו כאן סותר את
> ה-MANIFEST — ה-MANIFEST מנצח. סוכן שמתחיל מחזור על הנושא הזה: קרא → קח את ה-sub-step
> הפתוח הראשון מהבקלוג למטה → ממש את הגרסה הקטנה-נכונה עם טסט (happy/edge/fail-closed)
> → עדכן MANIFEST/STATUS/RUNBOOK. **sub-step אחד למחזור.**

---

## 0. למה השכבה הזאת היא ה-moat (קרא פעם אחת)

ה-thesis המרכזי של TFA: שכבת-אמון **ניטרלית חוצת-ספקים** שמוכיחה *מה הסוכן עשה* — תפקיד
שספק **לא יכול למלא מבנית עבור הסוכנים של עצמו** (אף CISO לא יקבל "xAI מאמתת את הסוכן
של xAI"). יושרת-היומן היא הלב של זה: אם אפשר לזייף את ה-audit trail, כל השאר חסר-ערך.

הקו שנבנה עד כה (כל פריט מאמת את הקודם):
`receipt חתום` → `Merkle anchoring` → `inclusion proof` → `consistency proof` (אי-שכתוב)
→ `witness co-signing` (אי-הסתרה) → `reputation freshness` (אי-replay). הצעד הבא הוא
**federation** (אמון חוצה-ארגונים) ו-**selective disclosure** (אמון בלי חשיפה).

---

## 1. הבסיס שכבר נבנה (אל תבנה מחדש — הרחב)

| יכולת | קובץ | מה היא מבטיחה |
|---|---|---|
| Merkle inclusion proof | `lib/transparency-log/merkle-tree.ts` | "הקבלה X ביומן עם root R" |
| Consistency proof | `lib/transparency-log/consistency-proof.ts` | היומן רק **גדל** — אי-שכתוב/split-view ניתן-לגילוי |
| Consistency monitor | `lib/transparency-log/consistency-monitor.ts` | בדיקת רצף-roots אוטומטית לאורך זמן |
| Witness co-signing | `lib/transparency-log/witness.ts` | witnesses בלתי-תלויים חותמים יחד → split-view **בלתי-אפשרי-להסתרה** |
| Witness registry + routes | `lib/transparency-log/witness-registry.ts`, `src/routes/witness-routes.ts` | רישום witnesses + endpoints (POST statement / GET quorum / GET statements) |
| Reputation freshness | `lib/track-record/proof-bundle-v2.ts` (`validUntil`) | proof-bundle נושא חסם-תוקף → אי-replay של מוניטין ישן |

**עיקרון:** כל אלה zero-dep, fail-closed, tenant-scoped, ו-verifier מחשב-מחדש (אפס-אמון
במוכיח). כל הרחבה חייבת לשמור על אותם כללים.

---

## 2. הפרונטיר הפתוח — בקלוג bounded, sub-step אחד למחזור

הסדר הוא סדר-ערך. כל פריט מפורק ל-sub-steps; קח את ה-sub-step הפתוח הראשון בלבד.

### A. Cross-log federation ("trust mesh") — הכי גבוה-ערך, חדשני
היום כל tenant הוא יומן נפרד. ארגונים שעושים עסקים זה עם זה צריכים להוכיח אמון **בלי**
לחשוף את כל השרשרת. זה מה שאף ספק לא בנה כי הוא דורש ניטרליות.
1. **`FederationAnchor` type + builder** — חתימה חוצת-יומנים שקושרת root של יומן א'
   ל-root של יומן ב' בנקודת-זמן, בלי לחשוף leaves. (sub-step ראשון: ה-type + ה-anchor
   החתום + אימות, בלי networking.)
2. **`verifyCrossLogConsistency`** — בהינתן שני anchors מיומנים שונים, אמת ששניהם
   מתיישבים עם witness quorum משותף.
3. **Mesh membership proof** — הוכחה ש-tenant הוא חבר ברשת-אמון מוגדרת בלי לחשוף את
   שאר החברים (Merkle membership מעל רשימת-trust-anchors).

### B. Selective disclosure / ZK-style proofs — חדשני, ערך-enterprise עצום
להוכיח עובדה על ה-track-record בלי לחשוף את הפעולות עצמן.
4. **Range/count proof** — "הסוכן עבר ≥N פעולות, 0 נדחו" כהוכחת-Merkle על תת-קבוצה,
   בלי לחשוף *אילו* פעולות. (sub-step ראשון: count-proof דטרמיניסטי + verifier.)
5. **Predicate proof** — "כל הפעולות של הסוכן היו מתחת ל-threshold-ערך X" בלי לחשוף
   סכומים. בנה על ה-Merkle הקיים; אל תכניס ספריית-ZK (zero-dep).
6. **Redacted proof-bundle** — וריאנט של proof-bundle-v2 שחושף רק שדות-verdict
   (pass/fail counts, vendor) ומסתיר resourceRef/value, עדיין חתום ובר-אימות.

### C. Predictive risk drift — מרחיב את ה-fusion engine הקיים
היום ה-risk engine מזהה חציית-סף. הצעד הבא: לזהות **מגמה** לפני הסף.
7. **`scoreRiskDrift`** — בהינתן חלון רשומות-עבר של סוכן, חשב שיפוע-הידרדרות
   דטרמיניסטי (monotonic, כמו scoreContextualRisk). מחזיר drift-score + direction.
8. **Drift-triggered escalation hook** — policy שמסלים כשה-drift חוצה סף *גם אם* הפעולה
   הבודדת מתחת לסף. fail-closed: drift לא-מחושב → ברירת-מחדל שמרנית.
9. **Drift explainability** — תרומת-כל-פקטור ל-drift (כמו risk-intelligence הקיים),
   לתשובת-compliance "למה הסוכן הזה הולך ומחמיר".

### D. Witness network hardening — משלים את witness שכבר נבנה
10. **Witness gossip protocol (in-process sim)** — witnesses מחליפים statements ומזהים
    אי-התאמה; sim מסומן (`-sim`) כי אין networking ב-sandbox.
11. **Quorum-in-verifier** — שה-public verifier יציג "K witnesses אישרו" לצד אימות-החתימה.
12. **Witness liveness/staleness** — לזהות witness ש"נעלם" (לא חתם על roots אחרונים) —
    אות לכשל או לקנוניה.

---

## 3. כללי-עבודה (חובה על כל פריט)

- **zero-dep, fail-closed, tenant-scoped, verifier מחשב-מחדש.** אל תכניס ספריית-crypto/ZK
  חיצונית — בנה מעל `node:crypto` וה-Merkle הקיים.
- **`-sim` למה שדורש networking** (gossip, cross-org transport) + הערת-אבטחה; אסור להציג
  sim כאמיתי.
- **טסט לכל sub-step:** happy + edge + fail-closed, רץ ירוק לפני אריזה.
- **Money = BigInt micro-cents.** Unknown → deny. cross-tenant → null/error.
- עדכן MANIFEST/STATUS/RUNBOOK יחד; "next missing" בפורמט em-dash.

---

## 4. רף לשינוי-עדיפויות

- אם witness adoption לא מתקדם (אין witnesses בפועל), הורד עדיפות ל-D והאץ את A/B
  (federation + selective disclosure עומדים בפני עצמם בלי רשת-witnesses).
- אם מתחרה משחרר trust-mesh חוצה-ספקים — A הופך לעדיפות-על.

---

*נוצר v395 (Claude). כיוון-מוצר — מצב-הקוד הקנוני הוא `MANIFEST.md`. הבסיס (סעיף 1)
נבדק מול הקוד; הפרונטיר (סעיף 2) פתוח.*
