#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · sovereign-milestones — אבני הדרך של הריבונות בספר
//
// מעדכן את המלאי (Zip ⇒ הבית הריבוני) ומוסיף את שלבי SOV:
//   SOV-1 SOVEREIGN-HOME — הספר חי בגיט; נסגר ע"י פעימה מקומית מה-clone
//   SOV-2 CLOUD-HEART   — הענן מפעיל את הרשת לבד; נסגר ע"י פעימת Actions
//   SOV-3 SELF-HOST     — הפלטפורמה עולה מ-clone נקי; נסגר ע"י אימות BUILD
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";

async function main(): Promise<void> {
  // 1. Zip — מ"מועמד למחיקה" ל"הבית הריבוני של THE WEAVE"
  const zip = await db.repoInventory.findUnique({ where: { name: "Zip" } });
  if (zip) {
    await db.repoInventory.update({
      where: { name: "Zip" },
      data: {
        currentRole: "ריפו ריק שהוסב (2026-09-14) — הוראת המפעיל: אל תמחק, המר",
        targetRole: "weave-core — הבית הריבוני: הספר בגיט + פעימת ענן + seal",
        findings:
          "אומת ריק (0KB, 0 רשומות) דרך ה-API ב-2026-09-14; הוסב לבית הריבוני של THE WEAVE — הספר (ledger.json), ה-seal, ה-workflow וקוד הפלטפורמה חיים בו",
        status: "CONSOLIDATED",
        dupScore: 0,
      },
    });
    console.log("[milestones] Zip ⇒ weave-core (הבית הריבוני) — המלאי עודכן");
  }

  // 2. שלבי SOV — אחרי EVM-3 (sortOrder 30..32)
  const stages: Array<{
    code: string;
    title: string;
    detail: string;
    gate: string;
    gateType: string;
    sortOrder: number;
  }> = [
    {
      code: "SOV-1",
      title: "בית ריבוני",
      detail:
        "הריפו Zip הוסב ל-weave-core: הספר (sovereign/ledger.json) חי בגיט, הסודות ב-seal בלבד, הדחיפות עוברות שער-סודות. הסנדבוקס הוא סתם workspace — הריפו הוא האמת.",
      gate: "פעימה מקומית מה-clone החי נדחפה ל-origin/main (ההוכחה: אימות הפעימה בספר + commit בגיט)",
      gateType: "MEASUREMENT",
      sortOrder: 30,
    },
    {
      code: "SOV-2",
      title: "לב ענן",
      detail:
        "weave-heart.yml ב-GitHub Actions: כל 6 שעות הענן קורא את הספר מהריפו; טרי ⇒ אימות-בלבד; ישן ⇒ TAKEOVER — הרחבה+checkpoint+דחיפה. הרשת לא נעצרת כשהסנדבוקס מת.",
      gate: "פעימה שנכתבה ע״י runner=github-actions מופיעה בספר (הרשת סוגרת לעצמה את השער)",
      gateType: "MEASUREMENT",
      sortOrder: 31,
    },
    {
      code: "SOV-3",
      title: "איחול-עצמי",
      detail:
        "clone נקי של weave-core ⇒ bun install ⇒ prisma db push ⇒ ייבוא ledger.json ⇒ הפלטפורמה חיה. זר כלשהו יכול להרים את הרשת ב-90 שניות בלי לסמוך עלינו (stranger-revive).",
      gate: "אימות BUILD מריץ-clone שהועלה מחוץ לסנדבוקס הזה",
      gateType: "BUILD",
      sortOrder: 32,
    },
  ];

  for (const s of stages) {
    const existing = await db.planStage.findUnique({ where: { code: s.code } });
    if (existing) {
      console.log(`[milestones] ${s.code} קיים — לא נוגע`);
      continue;
    }
    await db.planStage.create({ data: { ...s, state: "PLANNED" } });
    console.log(`[milestones] ${s.code} "${s.title}" נוסף (PLANNED)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("MILESTONES-ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
