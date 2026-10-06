// /api/agent-browser/sessions — ניהול סשנים של דפדפן הסוכנים.
// GET  → 20 הסשנים האחרונים (לרשימת "קישוריות חכמות" שמורות).
// POST → יצירת קישורית חכמה חדשה: המצב המלא (כרטיסיות + הקשר) נשמר
//        ב-DB וחוזר slug קצר. הקישורית ‎/#/browser?s=<slug>‎ עובדת על
//        כל דומיין שהאתר ייפרס עליו — כולל פריסה ריבונית עתידית.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { newSlug } from "@/lib/agent-browser/zai";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = await db.browserSession.findMany({
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        slug: true,
        title: true,
        visits: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ ok: true, sessions });
  } catch (err) {
    // R119 · חוק הכנות: כשל-DB אינו "רשימה ריקה" — הסתרת כישלון תציג אמת-שקר
    return NextResponse.json(
      {
        ok: false,
        error: `קריאת הסשנים נכשלה: ${err instanceof Error ? err.message : String(err)}`,
        sessions: [],
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let title = "סשן דפדפן";
  let state = "{}";
  try {
    const body = (await req.json()) as { title?: unknown; state?: unknown };
    if (typeof body?.title === "string" && body.title.trim()) {
      title = body.title.trim().slice(0, 120);
    }
    if (body?.state != null) {
      state = JSON.stringify(body.state);
      if (state.length > 200_000) {
        return NextResponse.json(
          { ok: false, error: "מצב הסשן גדול מדי (מקסימום 200KB)" },
          { status: 413 },
        );
      }
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }

  try {
    // slug ייחודי — ניסיון חוזר עד הצלחה (התנגשות 8 תווים היא אירוע נדיר)
    let slug = "";
    for (let i = 0; i < 6; i++) {
      const candidate = newSlug();
      const clash = await db.browserSession.findUnique({
        where: { slug: candidate },
        select: { slug: true },
      });
      if (!clash) {
        slug = candidate;
        break;
      }
    }
    if (!slug) {
      return NextResponse.json(
        { ok: false, error: "יצירת מזהה ייחודי נכשלה — נסה שוב" },
        { status: 500 },
      );
    }
    const session = await db.browserSession.create({
      data: { slug, title, state },
    });
    return NextResponse.json({ ok: true, slug: session.slug });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "שמירת הסשן נכשלה",
      },
      { status: 500 },
    );
  }
}
