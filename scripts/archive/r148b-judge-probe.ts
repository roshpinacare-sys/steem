// ─────────────────────────────────────────────────────────────────────
// r148-b · מדידת-ערוץ-השיפוט של שער-הכלכלה (probe · שרת-בלבד)
//
// למה זה קיים: ביום-המדידה (2026-10-02) התקציב-היומי כבר מוקצה (33/12),
// ולכן כל POST ל-/api/econ-gate נדחה דטרמיניסטית בשכבה-1 בלי להגיע
// לשיפוט-ה-LLM (החוק: DENY-התקציב גובר על הכל, D-r147-ECO). הסקריפט
// מודד את שכבה-2 לבדה — ערוץ-השיפוט האמיתי מהספרייה (אותו פרומפט,
// אותו ניתוח) — כדי להוכיח שה-LLM משיב נימוקים בעברית.
//
// גבולות: הפרוב לא מבצע דבר, לא כותב ליומן-השער, ואינו עוקף את התקרה
// בפועל — הוא קריאת-מדידה בלבד. רץ ידנית: bun scripts/r148b-judge-probe.ts
// ─────────────────────────────────────────────────────────────────────

import { judgeActionWithLlm, measureBudget } from "../src/lib/econ-gate";

async function main(): Promise<void> {
  const budget = measureBudget();
  const input = {
    actionId: "test-r148-b-1",
    kind: "probe",
    description: "בדיקת-שער — פעולת-מבחן ללא עלות",
    source: "manual-test",
  };
  console.log(`budget: ${budget.actionsToday}/${budget.cap} (actionDay ${budget.actionDay})`);
  console.log("שכבה-1 (תקציב) נמדדת ב-API החי; כאן נמדדת שכבה-2 (שיפוט) בלבד — בלי ביצוע, בלי יומן:");
  const t0 = Date.now();
  const verdict = await judgeActionWithLlm(input, budget, new Date().toISOString(), t0);
  console.log(JSON.stringify(verdict, null, 2));
}

main().catch((e) => {
  console.error("probe-failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
