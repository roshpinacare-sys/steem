// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Market API — POST /api/weave/market/open
//
// פתיחת שוק על טענה מדידה עתידית. המטרה עוברת ולידציה fail-closed
// (לא ניתן לפתוח שוק על עבר או על דבר שאינו ניתן למדידה); הפותח
// חותם על ה-OPEN במפתח הסוכן שלו (EIP-191).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { jsonError, readJsonBody } from "@/lib/weave/api";
import { MarketError, openMarket } from "@/lib/weave/market";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const title = typeof body.title === "string" ? body.title : "";
    const byDate = typeof body.byDate === "string" ? body.byDate : "";
    const createdBy = typeof body.createdBy === "string" ? body.createdBy.trim() : "";
    const sequence = body.sequence === true;
    const successorOf = typeof body.successorOf === "number" ? body.successorOf : undefined;

    if (!createdBy) {
      return NextResponse.json({ ok: false, error: "נדרש createdBy — agentId של סוכן פעיל" }, { status: 400 });
    }

    const { marketSeq, entryHash } = await openMarket({
      title,
      target: body.target,
      byDate,
      createdBy,
      ...(sequence ? { sequence } : {}),
      ...(successorOf != null ? { successorOf } : {}),
    });
    return NextResponse.json(
      { ok: true, market: { marketSeq, entryHash } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof MarketError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return jsonError(error);
  }
}
