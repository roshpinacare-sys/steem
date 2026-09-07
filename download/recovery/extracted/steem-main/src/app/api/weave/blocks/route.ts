import { NextRequest, NextResponse } from "next/server";
import { bookBlocks, replayWeave } from "@/lib/weave";

export const dynamic = "force-dynamic";

/**
 * GET /api/weave/blocks — פנקס-הבלוקים (אקספלורר).
 *
 * הספר מהארכיון-המלא + החלון-החם, ממוזג לפי-גובה (מטמון-mtime).
 *  ?height=H    — בלוק בודד מלא (txs + results)
 *  ?limit=N     — גודל-עמוד (ברירת-מחדל 50, מקס 200)
 *  ?offset=N    — עימוד מהחדש לאחור (0 = החדש ביותר)
 *  ?op=T        — סינון לבלוקים שמכילים טיפוס-פעולה (stamp/seal/witness/…)
 *  ?by=X        — סינון לבלוקים עם חותמת של חותם-על זה
 *  ?q=…         — גובה מדויק או קידומת-hash
 *  ?cp=1        — רק בלוקי צ'קפוינט (height % 12 == 0)
 * ה-API לעולם לא 500 — פנקס-ריק הוא מצב כנה.
 */

interface BlockRow {
  height: number;
  time: string | null;
  hash: string | null;
  prevHash: string | null;
  gasUsed: number;
  txCount: number;
  ops: Record<string, number>;
  firstNote: string | null;
  isCheckpoint: boolean;
}

function rowOf(b: any): BlockRow {
  const ops: Record<string, number> = {};
  let firstNote: string | null = null;
  for (const tx of (b.txs || []) as any[]) {
    const t = String(tx?.type || "?");
    ops[t] = (ops[t] || 0) + 1;
    if (!firstNote && tx?.note) firstNote = String(tx.note).slice(0, 120);
  }
  const height = Number(b.height);
  return {
    height,
    time: (b.time as string) || null,
    hash: (b.hash as string) || null,
    prevHash: (b.prevHash as string) || null,
    gasUsed: Number(b.gasUsed || 0),
    txCount: ((b.txs || []) as any[]).length,
    ops,
    firstNote,
    isCheckpoint: height > 0 && height % 12 === 0,
  };
}

function blockMatches(b: any, op: string, by: string, q: string, cp: boolean): boolean {
  if (cp && !(Number(b.height) > 0 && Number(b.height) % 12 === 0)) return false;
  if (!op && !by && !q) return true;
  if (q) {
    if (String(b.hash || "").startsWith(q)) return true;
    if (Number(b.height) === Number(q)) return true;
    return false;
  }
  const txs = (b.txs || []) as any[];
  if (op && !txs.some((t) => String(t?.type) === op)) return false;
  if (by && !txs.some((t) => String(t?.by || "").toLowerCase() === by)) return false;
  return true;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // בלוק בודד מלא
  const hRaw = sp.get("height");
  if (hRaw) {
    const h = Number(hRaw);
    if (!Number.isFinite(h)) return NextResponse.json({ ok: false, err: "bad-height" }, { status: 400 });
    const b = bookBlocks().find((x) => Number(x.height) === h) || null;
    if (!b) return NextResponse.json({ ok: false, err: "not-found", height: h });
    return NextResponse.json({ ok: true, block: b, isCheckpoint: h > 0 && h % 12 === 0 });
  }

  const limit = Math.max(1, Math.min(200, Number(sp.get("limit") || 50) || 50));
  const offset = Math.max(0, Number(sp.get("offset") || 0) || 0);
  const op = (sp.get("op") || "").trim().toLowerCase();
  const by = (sp.get("by") || "").trim().toLowerCase();
  const q = (sp.get("q") || "").trim().toLowerCase();
  const cp = sp.get("cp") === "1";

  const all = bookBlocks();
  const filtered = (op || by || q || cp) ? all.filter((b) => blockMatches(b, op, by, q, cp)) : all;
  const total = filtered.length;
  const start = Math.max(0, total - offset - limit);
  const page = filtered.slice(start, start + limit);

  return NextResponse.json({
    ok: true,
    tip: all.length ? Number(all[all.length - 1].height) : (replayWeave().height ?? null),
    totalBlocks: all.length,
    filtered: total,
    offset,
    limit,
    hasMore: offset + limit < total,
    blocks: page.reverse().map(rowOf),
  });
}
