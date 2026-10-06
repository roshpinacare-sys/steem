// ─────────────────────────────────────────────────────────────────────
// POST /api/charter/builders — שער הנפקת טוקנים-בונים (מפעיל בלבד).
//
// אותה דוקטרינה כמו /api/arm: ההרשאה היחידה היא השרשרת — סשן-מפעיל
// חתום HMAC (שנפתח בהזנת ה-active החי, נבדק מול api.steemit.com).
// הטוקן-בונה חוזר פעם אחת בתשובה ולעולם לא נשמר בבירור — hash בלבד.
// GET: רשימת הבונים לתצוגת המפעיל (בלי הטוקנים כמובן).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issueBuilder } from "@/lib/charter";
import { operatorFromRequest } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const op = operatorFromRequest(req);
  if (!op) {
    return NextResponse.json({ ok: false, error: "נדרש סשן-מפעיל" }, { status: 401 });
  }
  try {
    // R122 · חוק המספר-הנמדד: "projects: 0" קבוע היה מציג אפס-מדומה —
    // המספר האמיתי נספר מה-DB (groupBy על builderId, מודל מאונדקס).
    const [builders, projectCounts] = await Promise.all([
      db.builderToken.findMany({
        include: { agent: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.charterProject.groupBy({
        by: ["builderId"],
        _count: { _all: true },
      }),
    ]);
    const countByBuilder = new Map(projectCounts.map((c) => [c.builderId, c._count._all]));
    return NextResponse.json({
      ok: true,
      builders: builders.map((b) => ({
        name: b.agent.name,
        address: b.agent.ethAddress,
        prefix: b.prefix,
        active: b.active,
        issuedAt: b.createdAt.toISOString(),
        lastUsedAt: b.lastUsedAt?.toISOString() ?? null,
        projects: countByBuilder.get(b.agent.id) ?? 0, // נספר מה-DB — לא ממולא בצד הלקוח
      })),
    });
  } catch (err) {
    // R119/R122 · כשל-DB אינו רשימה ריקה — fail-closed כנה
    return NextResponse.json(
      {
        ok: false,
        error: `קריאת הבונים נכשלה: ${err instanceof Error ? err.message : String(err)}`,
        builders: [],
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const op = operatorFromRequest(req);
  if (!op) {
    return NextResponse.json(
      { ok: false, error: "נדרש סשן-מפעיל — פתח את שער המפעיל במספנה (הזנת ה-active)" },
      { status: 401 },
    );
  }
  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "גוף JSON חסר או שבור" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 40 || !/^[\w\u0590-\u05FF .-]+$/.test(name)) {
    return NextResponse.json(
      { ok: false, error: "שם הבונה חייב 2–40 תווים (עברית/לטינית/ספרות/מקף)" },
      { status: 422 },
    );
  }
  const taken = await db.agent.findUnique({ where: { name } });
  if (taken) {
    return NextResponse.json(
      { ok: false, error: `השם "${name}" תפוס ברשת — שם בונה הוא זהות ייחודית` },
      { status: 409 },
    );
  }

  const issued = await issueBuilder(name);
  // הטוקן חוזר פעם אחת — המפעיל מעביר אותו לסוכן החיצוני בבטחה משלו
  return NextResponse.json(
    {
      ok: true,
      builder: {
        name,
        address: issued.address,
        prefix: issued.prefix,
        noteHe:
          "הטוקן מוצג פעם אחת בלבד — העתק אותו עכשיו ומסור לסוכן הבונה. הרשת שומרת רק את ה-hash.",
      },
      token: issued.token,
    },
    { status: 201 },
  );
}
