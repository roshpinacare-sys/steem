// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Market API — POST /api/weave/market/stake
//
// הימור חתום: הסוכן שם נקודות אמת על YES (הטענה תאומת) או NO
// (תופרך). השרת מאמת הון מכסה (replay הספר הוא השופט), nonce
// מונוטוני נגזר מהספר (הגנת replay), והחתימה EIP-191 + ecrecover
// בזמן הכתיבה — "שום הימור בלי חתימה".
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { jsonError, readJsonBody } from "@/lib/weave/api";
import { MarketError, placeStake, type MarketOutcome } from "@/lib/weave/market";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const marketSeq = Number(body.marketSeq);
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    const side = body.side === "YES" || body.side === "NO" ? (body.side as MarketOutcome) : null;
    const points = Number(body.points);

    if (!Number.isInteger(marketSeq)) {
      return NextResponse.json({ ok: false, error: "נדרש marketSeq תקין" }, { status: 400 });
    }
    if (!agentId) {
      return NextResponse.json({ ok: false, error: "נדרש agentId של סוכן פעיל" }, { status: 400 });
    }
    if (!side) {
      return NextResponse.json({ ok: false, error: "נדרש side — YES או NO" }, { status: 400 });
    }

    const { seq, entryHash } = await placeStake({ marketSeq, agentId, side, points });
    return NextResponse.json({ ok: true, stake: { seq, entryHash, marketSeq, side, points } }, { status: 201 });
  } catch (error) {
    if (error instanceof MarketError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return jsonError(error);
  }
}
