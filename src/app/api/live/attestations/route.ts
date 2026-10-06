// ─────────────────────────────────────────────────────────────────────
// /api/live/attestations — ספר האימותים החי מהענן (מראה ציבורית).
// מוחזר בצורה תואמת-AttestationDTO ככל האפשר; שדות שהמראה אינה
// חושפת (חתימות, hashes פנימיים) מסומנים ככאלה באופן כנה.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getMirror } from "@/lib/live/cloud";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(
      300,
      Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 200) || 200)
    );
    const mirror = await getMirror();
    const entries = mirror.attestations.slice(0, limit).map((a) => ({
      seq: a.seq,
      agentId: a.agentName,
      agentName: a.agentName,
      agentAddress: "",
      claim: a.claim,
      claimType: a.type,
      evidence: "",
      evidenceHash: "",
      status: a.status,
      prevHash: "",
      entryHash: "",
      sig: null,
      signerAddr: null,
      createdAt: a.at,
    }));
    return NextResponse.json({
      ok: true,
      source: "cloud-mirror",
      total: mirror.stats.attestations,
      generatedAt: mirror.generatedAt,
      entries,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `הענן לא נענה: ${err.message}`
            : "הענן לא נענה — נסה שוב",
      },
      { status: 502 }
    );
  }
}
