import { NextRequest, NextResponse } from "next/server";
import { getLiveAccount } from "@/lib/steem/steem-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/steem/live?username=<account>
 * Live read-only snapshot of a real Steem account:
 * balances (SP breakdown), locked-funds vault with unlock timelines,
 * voting/RC power, yield engine + security audit.
 */
export async function GET(req: NextRequest) {
  const username = (req.nextUrl.searchParams.get("username") ?? "").trim().replace(/^@/, "");
  if (!username || !/^[a-z0-9\-.]{3,16}$/i.test(username)) {
    return NextResponse.json({ ok: false, error: "שם משתמש לא תקין" }, { status: 400 });
  }
  const snap = await getLiveAccount(username);
  return NextResponse.json(snap, { status: snap.ok ? 200 : 404 });
}
