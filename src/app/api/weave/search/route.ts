import { NextRequest, NextResponse } from "next/server";
import { bookBlocks, replayWeave } from "@/lib/weave";

export const dynamic = "force-dynamic";

/**
 * GET /api/weave/search?q=… — מתווך-חיפוש אחד לפנקס:
 *   · "#123" או מספר          → חותמת seq / בלוק בגובה זה
 *   · 64-hex (או קידומת ≥8)   → חותמת לפי hash / בלוק לפי hash / איטום לפי שורש
 * מחזיר מספר-תוצאות קטן לכל-סוג — הלקוח מציג ומנווט.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  if (!q) return NextResponse.json({ ok: true, q, results: [] });

  const results: Record<string, unknown>[] = [];
  const rp = replayWeave();
  const all = bookBlocks();
  const isSeq = /^#?\d{1,9}$/.test(q);
  const isHex = /^[0-9a-f]{8,64}$/.test(q);

  if (isSeq) {
    const n = Number(q.replace("#", ""));
    const stamp = (rp.stampLog || []).find((s) => s.seq === n);
    if (stamp) results.push({ kind: "stamp", stamp });
    const block = all.find((b) => Number(b.height) === n);
    if (block) results.push({ kind: "block", height: Number(block.height), time: block.time || null });
  }

  if (isHex) {
    const stamp = (rp.stampLog || []).find((s) => s.h.startsWith(q));
    if (stamp) results.push({ kind: "stamp", stamp });
    const block = all.find((b) => String(b.hash || "").startsWith(q));
    if (block) results.push({ kind: "block", height: Number(block.height), time: block.time || null });
    const seal = ((rp.weave?.seals as any[] | undefined) || []).find((s) => String(s.root || "").startsWith(q));
    if (seal) results.push({ kind: "seal", seal });
  }

  return NextResponse.json({ ok: true, q, results: results.slice(0, 8) });
}
