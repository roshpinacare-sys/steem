// ─────────────────────────────────────────────────────────────────────
// r148-converge · חתימת גל-"המכונה-העסקית" בשרשרת-ההחלטות
// רץ ידנית: bun scripts/r148-sign-decisions.ts
// אימות-אחרי-חתימה מובנה (verifyDecisionLog) — אין חתימה בלי אימות.
// ─────────────────────────────────────────────────────────────────────

import { appendDecision, verifyDecisionLog } from "../src/lib/weave/sovereign-decisions";

async function main(): Promise<void> {
  const entries: Array<Parameters<typeof appendDecision>[0]> = [
    {
      decisionId: "D-r148-A",
      class: "economy",
      chosen:
        "הפעלת מנוע-העסקים (mini-services/business · 3045) עם צינור-claim_rewards ראשון בקודבייס (active key) — B-1 דלפק-הדלק מקבל מימוש אמת: מדידה חי 10 דק' · תביעה כשיש מה לתבוע (סף 0.1 SP · שמירת-23ש') · B-2 תדריך-שוק יומי מדוד · שורות-הרג נאכפות",
      why: "חממת-העסקים (D-r147-BIZ) הייתה מסמך; המפעיל הורה לחשוב-גדול וליישם-הכל. המדידה גילתה claim_rewards=0 מופעים — הגלגל-החוסם של B-1",
      boundary:
        "AUTO (D-OP-01) · תקציב-שידורים 12/יום · אפס-מפתחות בתשובות · fail-soft על כל מקור",
      evidence: JSON.stringify({
        briefTxid: "2628839343a32bb9dd6b204db43823e9da7d3345",
        briefPermlink: "the-weave-measured-market-brief-2026-10-02-muqzg6kw",
        claimGet: "reward_vests 0.000 → claimable=false (api.steemit.com 13:12Z)",
        claimPostRefusal: "HTTP 409 NOTHING-PENDING — הסירוב הוא ההוכחה",
        engineTicks: 5,
        engineBudget: "1/3 שידורים היום",
        commit: "7596bc8 → origin אומת ls-tree",
      }),
    },
    {
      decisionId: "D-r148-B",
      class: "gate",
      chosen:
        "שער-הכלכלה חי (/api/econ-gate): שכבה-1 תקציב-שידורים דטרמיניסטי מהמונים החיים (money+business) · שכבה-2 שיפוט-LLM לפי שבעת-החוקים בעברית · חיווט fail-open בלולאת-הממשל",
      why: "הלקחים החיים: 7 דחיות NO-FUEL שרפו 7/12 תקציב (r147-a) · governor של clodfarm (חוקי-קיבולת). המפעיל הורה לאמן חשיבה-כלכלית",
      boundary:
        "AUTO (D-OP-01) · תקרה-קשה להוצאה בלבד (spend=true) · מידה/ממשל = עצה נרשמת · כשל-שער = כשל-פתוח",
      evidence: JSON.stringify({
        budgetFix: "תקרית-34/12: ספירת-שורות-יומן תוקנה למוני-שידורים — GET אמת 13/12 (money 12 + engine 1)",
        spendProbe: "DENY 13/12 כן — התקרה אוכפת",
        judgeProbe: "glm-4-plus score 35 → DENY על 'לא דווח' — קפדנות-חוקים חיה",
        loopResumed: "cycles 92→95 · lastGate ALLOW score=85 · verdict DECIDED",
        commit: "18f8d8c → origin אומת ls-tree",
      }),
    },
    {
      decisionId: "D-r148-C",
      class: "evidence",
      chosen:
        "חזית-העסקים חיה בבית: נתיב 'עסקים' חדש ב-SPA (#/business/desk) — כרטיסים חיים עברית-ראש לכל עסק: שלב · מספרים-חיים · שורת-הרג · יומן-חי (צריכה-אם-קיים)",
      why: "המפעיל קרא בעברית בלבד — העסקים חייבים להיות נראים עם מספרים חיים, לא מסמך בדיסק",
      boundary: "AUTO (D-OP-01) · קריאה-בלבד מ-/api/businesses · אפס-כחול/אינדיגו · fail-soft כן",
      evidence: JSON.stringify({
        browser: "דסקטופ+מובייל 390 נבדקו · שגיאות-קונסולה 0 · גריד 1-עמודה מובייל · פוטר-דביק נשמר",
        screenshots: "sovereign/evidence/r148-c-businesses-view{,-mobile}.png",
        commit: "08f7430 → origin אומת ls-tree",
      }),
    },
    {
      decisionId: "D-r148-D",
      class: "economy",
      chosen:
        "פתיחת B-4 דלפק-הפיד הציבורי (PILOT): ה-API-ים הציבוריים כמוצר מדוד — מוני-שימוש אמת (feed-metrics) · קטלוג-API ציבורי (/api/businesses/docs) · ONE-READ למפעיל בעברית",
      why: "עלות-שולית אפס על מסילות חיות (r147-c); חוק-הראיה: מדידת-שימוש אמת לפני הכרעת-פורמט (שורת-הרג 30 יום)",
      boundary: "AUTO (D-OP-01) · אפס-פעולות (קריאה בלבד) · מונים fail-soft לעולם לא שוברים API",
      evidence: JSON.stringify({
        counterProof: "/api/businesses requests 5→6→7 בקריאות-רצופות · שוחזר-מהדיסק אחרי-הקמה-מחדש",
        catalog: "api-catalog-v1 · 6 נתיבים · שדות מקוד ומתשובה-חיה (אפס המצאה)",
        oneRead: "sovereign/businesses/ONE-READ.md — 4 עסקים · 3 שערי-מפעיל · 'איפה הכסף באמת'",
        commit: "bbf2ab9 + 70b01b1 → origin אומת ls-tree",
      }),
    },
  ];

  for (const e of entries) {
    const sealed = appendDecision(e);
    console.log(`חתום: ${sealed.decisionId} seq=${sealed.seq} hash=${sealed.entryHash.slice(0, 12)}…`);
  }

  const v = verifyDecisionLog();
  console.log(`אימות-שרשרת: ok=${v.ok} brokenAt=${v.brokenAt} entries=${v.entries}`);
  if (!v.ok) {
    console.error("השרשרת נשברה — עצירה");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("כישלון-חתימה:", e);
  process.exit(1);
});
