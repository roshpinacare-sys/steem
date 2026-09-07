import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Console runbook — operator execution tasks (docs/CONSOLE_PLAN.md §4).
 * READ-ONLY chain: tasks are the operator's own progress tracking, no keys.
 *
 * GET                 → { tasks } (seeds the wave-4 runbook on first call)
 * POST   { title, phase?, description?, keyAuth?, sourceDoc?, order? } → { task }
 * PATCH  { id, status? | title? | description? | phase? }             → { task }
 * DELETE ?id=                                                        → { ok }
 */
const PHASES = new Set(["week1", "month1", "quarter"]);
const STATUSES = new Set(["todo", "active", "done", "blocked"]);
const KEY_AUTHS = new Set(["posting", "active", "owner-offline", "none"]);

const RUNBOOK_SEED = [
  {
    order: 1,
    phase: "week1",
    title: "תביעת הפרסים הממתינים (26.3 SP)",
    description:
      "claim_reward_balance על הפרסים הממתינים — posting key בלבד, אפס סיכון. הקישור המוכן בכרטיס הפעולה (prepare).",
    keyAuth: "posting",
    sourceDoc: "docs/EXPLORATION_WAVE4.md §5",
  },
  {
    order: 2,
    phase: "week1",
    title: "ניקוי 7 הרשאות ה-posting המיושנות",
    description:
      "7 מתוך 8 ההרשאות מ-2018 — ירידה ל-posting key יחיד. חתימה אופליין בלבד לפי מדריך 4 השלבים. לעולם לא דרך קישור חתימה מקוון.",
    keyAuth: "owner-offline",
    sourceDoc: "docs/KEY_CAPABILITIES.md §5",
  },
  {
    order: 3,
    phase: "week1",
    title: "ברית-עדים (S7) — מילוי 30 מקומות הצבעה",
    description:
      "הצבעה ל-30 עדים איכותיים-מתואמים בעלות אפס. מקסום השפעה גוברת עם צבירת ה-SP. קישורי חתימה לכל עד בכרטיס הפעולה.",
    keyAuth: "posting",
    sourceDoc: "docs/SOLO_MODEL_PLAYBOOK.md S7",
  },
  {
    order: 4,
    phase: "week1",
    title: "הפעלת קוראציה ממוקדת (BOT-2/BOT-10)",
    description:
      "רשימת-מעקב איכותית + הצבעה 5-15 דקות אחרי פרסום. APR נמדד 3.3-7.6% וצבירת SP — הווקטור היציב ללא הון נוסף.",
    keyAuth: "posting",
    sourceDoc: "docs/EXPLORATION_WAVE2.md §1",
  },
  {
    order: 5,
    phase: "month1",
    title: "BOT-3 — מחזור המרה ראשון (דורש הון חוץ)",
    description:
      "הזרמת $50-100 → קניית SBD → convert (3.5 יום) → מכירה פנימית. חלון נמדד +115.7% למחזור. אימות feed חוזה סמוך לביצוע; רישום התוצאה ביומן ההון.",
    keyAuth: "active",
    sourceDoc: "docs/EXPLORATION_WAVE4.md §1",
  },
  {
    order: 6,
    phase: "month1",
    title: "מעקב שבועי — feed + spread (סקריפט wave4)",
    description:
      "הרצת .zscripts/wave4_measure.py פעם בשבוע: אימות feed מול שוק (חלון BOT-3 חי/סגור) ופער בין-מקומי (פתיחה מחדש BOT-4/5).",
    keyAuth: "none",
    sourceDoc: "docs/EXPLORATION_WAVE4.md §8",
  },
  {
    order: 7,
    phase: "month1",
    title: "S1 — מוכר-הצבעות AI על ה-VP המבוזבז",
    description:
      "VP 97.99% — ~7 הצבעות מלאות נשרפות כל יום. רשימת-טרייל איכותית עם מסנן AI ממירה ל-890-1150 STEEM/שנה.",
    keyAuth: "posting",
    sourceDoc: "docs/SOLO_MODEL_PLAYBOOK.md S1",
  },
  {
    order: 8,
    phase: "month1",
    title: "S2 — חשיפת מפעל-החשבונות בקהילות",
    description:
      "המודול חי בסימולציה (1.75 STEEM מול רשמי 3.00). פרסום הצעה בקהילות + ערוץ פנייה — והפיד יתחיל לתעד לקוחות אמיתיים.",
    keyAuth: "active",
    sourceDoc: "docs/SOLO_MODEL_PLAYBOOK.md S2",
  },
  {
    order: 9,
    phase: "quarter",
    title: "BOT-1 — השכרת SP בצבירת 500 SP נזיל",
    description:
      "~15% APR מאומת מול 7.6% קוראציה. הקצאה לשוק ההשכרה, החזר נזילות ב-5 ימים. מותנה בצבירת מאגר.",
    keyAuth: "active",
    sourceDoc: "docs/EXECUTION_PLAYBOOK.md BOT-1",
  },
  {
    order: 10,
    phase: "quarter",
    title: "החלטת צי — claim_account + delegate_rc",
    description:
      "בהתקדמות ה-SP: claim חינם של חשבונות + הקצאת RC לצי bot-content. תשתית הקרנל תומכת (5 ops חדשים).",
    keyAuth: "active",
    sourceDoc: "docs/SOLO_MODEL_PLAYBOOK.md S2",
  },
];

async function seedIfEmpty() {
  const count = await db.opsTask.count();
  if (count === 0) {
    await db.opsTask.createMany({ data: RUNBOOK_SEED });
  }
}

export async function GET() {
  await seedIfEmpty();
  const tasks = await db.opsTask.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const byStatus: Record<string, number> = { todo: 0, active: 0, done: 0, blocked: 0 };
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  return NextResponse.json({ tasks, byStatus, total: tasks.length });
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      title?: string;
      phase?: string;
      description?: string;
      keyAuth?: string;
      sourceDoc?: string;
      order?: number;
    };
    const title = (b.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "חסרה כותרת משימה" }, { status: 400 });
    const maxOrder = await db.opsTask.aggregate({ _max: { order: true } });
    const task = await db.opsTask.create({
      data: {
        title,
        phase: b.phase && PHASES.has(b.phase) ? b.phase : "month1",
        description: (b.description ?? "").slice(0, 800),
        keyAuth: b.keyAuth && KEY_AUTHS.has(b.keyAuth) ? b.keyAuth : "none",
        sourceDoc: (b.sourceDoc ?? "").slice(0, 200),
        order: b.order ?? (maxOrder._max.order ?? 0) + 1,
      },
    });
    return NextResponse.json({ task });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      id?: string;
      status?: string;
      title?: string;
      description?: string;
      phase?: string;
    };
    if (!b.id) return NextResponse.json({ error: "חסר id" }, { status: 400 });
    const data: Record<string, string> = {};
    if (b.status) {
      if (!STATUSES.has(b.status)) return NextResponse.json({ error: "סטטוס לא תקין" }, { status: 400 });
      data.status = b.status;
    }
    if (b.title) data.title = b.title.trim().slice(0, 200);
    if (b.description !== undefined) data.description = b.description.slice(0, 800);
    if (b.phase && PHASES.has(b.phase)) data.phase = b.phase;
    if (Object.keys(data).length === 0)
      return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
    const task = await db.opsTask.update({ where: { id: b.id }, data });
    return NextResponse.json({ task });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "שגיאה" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "חסר id" }, { status: 400 });
  await db.opsTask.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
