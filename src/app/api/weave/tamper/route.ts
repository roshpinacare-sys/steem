// POST /api/weave/tamper — דמו צוות-אדום מסומן ("ערעור מדומה"):
// שינוי ישיר של שדה ב-DB בלי חישוב hash מחדש — כדי להוכיח שהשרשרת תופסת.
// body: { seq?: number, field?: "claim" | "evidence" | "status" }
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, readJsonBody } from "@/lib/weave/api";

const TAMPER_FIELDS = ["claim", "evidence", "status"] as const;
type TamperField = (typeof TAMPER_FIELDS)[number];

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);

    const hasSeq = typeof body.seq === "number" && Number.isInteger(body.seq);
    const seq = hasSeq ? (body.seq as number) : null;
    const field: TamperField =
      typeof body.field === "string" && TAMPER_FIELDS.includes(body.field as TamperField)
        ? (body.field as TamperField)
        : "claim";

    let row =
      seq !== null
        ? await db.attestation.findUnique({ where: { seq }, include: { agent: true } })
        : null;

    if (seq !== null && !row) {
      return NextResponse.json(
        { ok: false, error: `לא נמצא אימות עם seq ${seq} בספר` },
        { status: 400 }
      );
    }

    // בלי seq — שורה VERIFIED אקראית (ההדגמה הברורה ביותר)
    if (!row) {
      const verified = await db.attestation.findMany({
        where: { status: "VERIFIED" },
        orderBy: { seq: "asc" },
        select: { seq: true },
      });
      if (verified.length === 0) {
        return NextResponse.json(
          { ok: false, error: "אין רשומות VERIFIED לערעור — הספר ריק או מעורער כולו" },
          { status: 400 }
        );
      }
      const pick = verified[Math.floor(Math.random() * verified.length)];
      row = await db.attestation.findUnique({ where: { seq: pick.seq }, include: { agent: true } });
    }
    if (!row) {
      return NextResponse.json(
        { ok: false, error: "לא נמצאה רשומה לערעור מדומה" },
        { status: 400 }
      );
    }

    const before: string = row[field];
    const after: string =
      field === "status" ? "REFUTED" : `⚠ TAMPER-DEMO ${new Date().toISOString()}`;

    // שינוי ישיר — בלי לחשב entryHash/evidenceHash מחדש (זה כל העניין)
    const data: { claim?: string; evidence?: string; status?: string } = {};
    data[field] = after;
    await db.attestation.update({ where: { seq: row.seq }, data });

    return NextResponse.json({
      ok: true,
      seq: row.seq,
      field,
      before,
      after,
    });
  } catch (error) {
    return jsonError(error);
  }
}
