// POST /api/plan/close — סגירת שלב באימות VERIFIED בלבד (השער המובנה):
//   השלב קיים ואינו DONE; האימות קיים, status==="VERIFIED"
//   ו-claimType===stage.gateType. אחרת — 400 עם סיבה בעברית.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, readJsonBody, toStageDTO } from "@/lib/weave/api";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);

    const code = typeof body.code === "string" ? body.code.trim() : "";
    const attestationSeq =
      typeof body.attestationSeq === "number" && Number.isInteger(body.attestationSeq)
        ? body.attestationSeq
        : null;

    if (!code) {
      return NextResponse.json(
        { ok: false, error: "נדרש code של שלב בתוכנית" },
        { status: 400 }
      );
    }
    if (attestationSeq === null) {
      return NextResponse.json(
        { ok: false, error: "נדרש attestationSeq תקין (מספר שלם) של אימות בספר" },
        { status: 400 }
      );
    }

    const stage = await db.planStage.findUnique({ where: { code } });
    if (!stage) {
      return NextResponse.json(
        { ok: false, error: `השלב ${code} לא נמצא בתוכנית` },
        { status: 400 }
      );
    }
    if (stage.state === "DONE") {
      return NextResponse.json(
        { ok: false, error: `השלב ${code} כבר סגור (DONE) — אין מה לסגור שוב` },
        { status: 400 }
      );
    }

    const attestation = await db.attestation.findUnique({ where: { seq: attestationSeq } });
    if (!attestation) {
      return NextResponse.json(
        { ok: false, error: `האימות seq ${attestationSeq} לא נמצא בספר` },
        { status: 400 }
      );
    }
    if (attestation.status !== "VERIFIED") {
      const reason =
        attestation.status === "UNMEASURED"
          ? "האימות UNMEASURED — טענה בלי מדידה לא סוגרת שער"
          : `האימות ${attestation.status} — רק אימות VERIFIED סוגר שער`;
      return NextResponse.json({ ok: false, error: reason }, { status: 400 });
    }
    if (attestation.claimType !== stage.gateType) {
      return NextResponse.json(
        {
          ok: false,
          error: `סוג הטענה ${attestation.claimType} אינו תואם לשער — נדרש אימות ${stage.gateType}`,
        },
        { status: 400 }
      );
    }

    const updated = await db.planStage.update({
      where: { code },
      data: { state: "DONE", attSeq: attestation.seq },
    });

    return NextResponse.json({ ok: true, stage: toStageDTO(updated) });
  } catch (error) {
    return jsonError(error);
  }
}
