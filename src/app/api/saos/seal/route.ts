// ─────────────────────────────────────────────────────────────────────
// /api/saos/seal — תצוגת-מצב החותם בתא-הפיקוד (אפס סודות בתשובה)
// המעטפות: sovereign/weave-seal.enc + sovereign/headcorner-seal.enc
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { sealStatus } from "@/lib/seal";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await sealStatus();
    return NextResponse.json({ ok: true, ...status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "seal-status-failed", detail: String(e instanceof Error ? e.message : e).slice(0, 160) },
      { status: 500 },
    );
  }
}
