// ─────────────────────────────────────────────────────────────────────
// /api/web/verify/[hash] — מנוע ההוכחות v2: אימות חי מקיר-לקיר מול
// ה-RPC הציבורי של Steem ו-Hive, בסריקה-עמוקה + קריאות-בלוק ממוקדות.
// כל צ׳אנק, כל חשיש, כולל עומק-הסריקה שנקרא באמת עד למציאת האמת.
//
// R51: ?entries=N שולט בתקציב-הרשומות (ברירת-מחדל 2,000 · תקרה 30,000).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { verifyPackageOnChain, looksLikeSha256 } from "@/lib/web/netstore";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ hash: string }> }
) {
  const { hash } = await ctx.params;
  if (!looksLikeSha256(hash)) {
    return NextResponse.json(
      { ok: false, error: "נדרש חשיש sha256 בן 64 תווי-הקס" },
      { status: 400 }
    );
  }
  const entriesRaw = Number(req.nextUrl.searchParams.get("entries") || 0);
  const entries = Number.isFinite(entriesRaw) && entriesRaw > 0 ? Math.min(Math.floor(entriesRaw), 30_000) : undefined;
  try {
    const report = await verifyPackageOnChain(hash, entries);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "האימות נכשל" },
      { status: 502 }
    );
  }
}
