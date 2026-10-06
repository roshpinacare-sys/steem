// /api/agent-browser/sessions/[slug] — שחזור קישורית חכמה.
// GET → הסשן המלא (מצב JSON) + הגדלת מונה הביקורים — הפתיחה נמדדת.
// PUT → עדכון מצב (המשך עבודה על סשן ששוחזר).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// R122 · חוק הכנות: 404 רק ל"רשומה לא נמצאה" (P2025). כל שגיאה אחרת
// (DB מת, נעילה, רשת) היא 500 כנה — תקלת-תשתית אינה \"לא נמצא\".
function isRecordNotFound(e: unknown): boolean {
  return (e as { code?: string } | null | undefined)?.code === "P2025";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!/^[a-z0-9]{4,16}$/.test(slug)) {
    return NextResponse.json(
      { ok: false, error: "מזהה קישורית לא תקין" },
      { status: 400 },
    );
  }
  try {
    const session = await db.browserSession.update({
      where: { slug },
      data: { visits: { increment: 1 } },
    });
    let state: unknown = {};
    let stateCorrupted = false;
    try {
      state = JSON.parse(session.state);
    } catch {
      // R123 · חוק הכנות: מצב שבור אינו מוצג כסשן ריק בשקט — הדגל נמסר
      // ללקוח כדי שהמשתמש יידע שהעבודה הקודמת לא נקראה (אובדן-ראיה, לא אפס).
      state = {};
      stateCorrupted = true;
    }
    return NextResponse.json({
      ok: true,
      session: {
        slug: session.slug,
        title: session.title,
        visits: session.visits,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        state,
        stateCorrupted,
      },
    });
  } catch (e) {
    if (isRecordNotFound(e)) {
      return NextResponse.json(
        { ok: false, error: "הקישורית לא נמצאה — ייתכן שנמחקה" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: `קריאת הקישורית נכשלה: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!/^[a-z0-9]{4,16}$/.test(slug)) {
    return NextResponse.json(
      { ok: false, error: "מזהה קישורית לא תקין" },
      { status: 400 },
    );
  }
  let state = "{}";
  let title: string | undefined;
  try {
    const body = (await req.json()) as { state?: unknown; title?: unknown };
    if (body?.state != null) {
      state = JSON.stringify(body.state);
      if (state.length > 200_000) {
        return NextResponse.json(
          { ok: false, error: "מצב הסשן גדול מדי" },
          { status: 413 },
        );
      }
    }
    if (typeof body?.title === "string" && body.title.trim()) {
      title = body.title.trim().slice(0, 120);
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }
  try {
    const session = await db.browserSession.update({
      where: { slug },
      data: { state, ...(title ? { title } : {}) },
    });
    return NextResponse.json({ ok: true, slug: session.slug });
  } catch (e) {
    if (isRecordNotFound(e)) {
      return NextResponse.json(
        { ok: false, error: "הסשן לא נמצא לעדכון" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: `עדכון הסשן נכשל: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 500 },
    );
  }
}
