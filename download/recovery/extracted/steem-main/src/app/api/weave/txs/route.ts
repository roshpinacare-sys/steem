import { NextRequest, NextResponse } from "next/server";
import { bookBlocks, bookKey } from "@/lib/weave";

export const dynamic = "force-dynamic";

/**
 * GET /api/weave/txs — אינדקס-הפעולות המאוחד (הטרנזקציות על הספר).
 *
 * כל tx מכל בלוק — שטוח, ניתן-לסינון ולעימוד מהחדש לאחור:
 *  ?type=stamp|seal|witness|heartbeat|checkpoint|transfer
 *  ?by=NAME  ?kind=K  ?seq=N  ?h=<hex-prefix>  ?err=1
 *  ?limit=N (ברירת-מחדל 50, מקס 200)  ?offset=N
 *
 * ה-API לעולם לא 500 — אינדקס-ריק הוא מצב כנה.
 */

interface TxRow {
  height: number;
  idx: number;
  time: string | null;
  type: string;
  ok: boolean;
  err: string | null;
  gas: number;
  tx: Record<string, unknown>;
}

type FlatCache = { key: string; rows: TxRow[] };
let cache: FlatCache | null = null;

function flatten(): TxRow[] {
  const key = bookKey();
  if (cache && cache.key === key) return cache.rows;
  const rows: TxRow[] = [];
  for (const b of bookBlocks()) {
    const txs = (b.txs || []) as any[];
    const results = (b.results || []) as any[];
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i] || {};
      const r = results[i] || null;
      rows.push({
        height: Number(b.height),
        idx: i,
        time: (b.time as string) || null,
        type: String(tx.type || "?"),
        ok: r ? !!r.ok : true,
        err: r?.err ? String(r.err) : null,
        gas: Number(r?.gas ?? 0),
        tx,
      });
    }
  }
  rows.reverse(); // החדש ביותר ראשון
  cache = { key, rows };
  return rows;
}

function txField(tx: Record<string, unknown>, k: string): string {
  return String(tx?.[k] ?? "").toLowerCase();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = (sp.get("type") || "").trim().toLowerCase();
  const by = (sp.get("by") || "").trim().toLowerCase();
  const kind = (sp.get("kind") || "").trim().toLowerCase();
  const seqRaw = sp.get("seq");
  const h = (sp.get("h") || "").trim().toLowerCase();
  const errOnly = sp.get("err") === "1";

  const limit = Math.max(1, Math.min(200, Number(sp.get("limit") || 50) || 50));
  const offset = Math.max(0, Number(sp.get("offset") || 0) || 0);

  const all = flatten();
  const seq = seqRaw !== null && seqRaw !== "" ? Number(seqRaw) : null;
  const filtered = all.filter((r) => {
    if (type && r.type !== type) return false;
    if (errOnly && r.ok) return false;
    if (by && txField(r.tx, "by") !== by) return false;
    if (kind && txField(r.tx, "kind") !== kind) return false;
    if (seq !== null && Number(r.tx?.seq) !== seq) return false;
    if (h && !String(r.tx?.h || "").toLowerCase().startsWith(h)) return false;
    return true;
  });

  const page = filtered.slice(offset, offset + limit);
  return NextResponse.json({
    ok: true,
    total: all.length,
    filtered: filtered.length,
    offset,
    limit,
    hasMore: offset + limit < filtered.length,
    txs: page,
  });
}
