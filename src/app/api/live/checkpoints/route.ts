// ─────────────────────────────────────────────────────────────────────
// /api/live/checkpoints — צ'קפוינטים חיים מהענן (מראה ציבורית).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getMirror } from "@/lib/live/cloud";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(
      100,
      Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50)
    );
    const mirror = await getMirror();
    const entries = mirror.checkpoints.slice(0, limit).map((c) => ({
      index: c.index,
      attFrom: c.attFrom,
      attTo: c.attTo,
      leafCount: Math.max(1, c.attTo - c.attFrom + 1),
      root: c.root,
      prevRoot: "",
      entryHash: "",
      sig: null,
      signerAddr: null,
      anchorStatus:
        c.anchoredOn && c.anchoredOn.length > 0
          ? `ANCHORED (${c.anchoredOn.join("+")})`
          : "LOCAL",
      anchorNet: c.anchoredOn?.[0] ?? null,
      anchorTx: null,
      calldata: null,
      createdAt: c.at,
    }));
    return NextResponse.json({
      ok: true,
      source: "cloud-mirror",
      total: mirror.stats.checkpoints,
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
