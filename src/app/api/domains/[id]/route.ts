// /api/domains/[id] — עדכון סטטוס / מחיקת דומיין מהרישום.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// R122 · חוק הכנות: 404 רק ל"רשומה לא נמצאה" (P2025). כל שגיאה אחרת
// (DB מת, נעילה, רשת) היא 500 כנה — תקלת-תשתית אינה "לא נמצא".
function isRecordNotFound(e: unknown): boolean {
  return (e as { code?: string } | null | undefined)?.code === "P2025";
}

const STATUSES = new Set(["PLANNED", "DNS", "DEPLOYING", "LIVE"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let data: { status?: string; notes?: string; purpose?: string } = {};
  try {
    const body = (await req.json()) as {
      status?: unknown;
      notes?: unknown;
      purpose?: unknown;
    };
    if (typeof body?.status === "string") {
      if (!STATUSES.has(body.status)) {
        return NextResponse.json(
          { ok: false, error: "סטטוס לא מוכר" },
          { status: 400 },
        );
      }
      data.status = body.status;
    }
    if (typeof body?.notes === "string") data.notes = body.notes.slice(0, 500);
    if (typeof body?.purpose === "string")
      data.purpose = body.purpose.slice(0, 300);
  } catch {
    return NextResponse.json(
      { ok: false, error: "גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }
  try {
    const updated = await db.sovereignDomain.update({ where: { id }, data });
    return NextResponse.json({ ok: true, domain: updated });
  } catch (e) {
    if (isRecordNotFound(e)) {
      return NextResponse.json(
        { ok: false, error: "הדומיין לא נמצא" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: `עדכון הדומיין נכשל: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await db.sovereignDomain.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isRecordNotFound(e)) {
      return NextResponse.json(
        { ok: false, error: "הדומיין לא נמצא" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: `מחיקת הדומיין נכשלה: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 500 },
    );
  }
}
