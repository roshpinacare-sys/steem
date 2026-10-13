import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

// sanbox operator boards — bridge from the durable sanbox/ worktree (origin/saos-cockpit).
// Preview-side only: the durable source of truth lives in the git folder, not here.
export const dynamic = "force-dynamic";

const FILES: Record<string, string> = {
  routing: "routing.json",
  rewards: "rewards-attribution.json",
  yield: "yield-board.json",
};

const WT = process.env.SANBOX_WT ?? "/home/z/wt-cockpit";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("file") ?? "";
  const file = FILES[key];
  if (!file) {
    return NextResponse.json({ ok: false, error: "unknown-board" }, { status: 400 });
  }
  try {
    const raw = await readFile(path.join(WT, "sanbox", "autonomy", file), "utf8");
    return NextResponse.json(
      { ok: true, key, data: JSON.parse(raw) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "read-failed";
    return NextResponse.json({ ok: false, error: code }, { status: 404 });
  }
}
