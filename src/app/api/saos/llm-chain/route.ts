import { NextResponse } from "next/server";
import { chainKpis, chainSpec, drillChain, flushFastPath } from "@/lib/llm-chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * R285 · THE LLM-CHAIN BOARD (the resilience plane, visible).
 *
 * GET — the flat board: KPIs derived from the metadata-only ledger (the
 * server recycles; the ledger stays), the last 20 rows (names and classes
 * only, never prompt content), and the chain spec.
 *
 * POST — engine/operator ops, flat envelope law:
 *   {op:"drill"}  proves the wiring end to end (forced-fail candidate, a real
 *                 1-token provider call, a local echo backstop). Returns
 *                 drillOk SEPARATE from this POST's own ok.
 *   {op:"flush"}  empties the fast-path cache, reports how many entries were
 *                 spilled.
 * Honest limits: the chain fails over within one turn; it does not queue or
 * retry for minutes; the fast path serves the exact keyed input only.
 */

export async function GET() {
  try {
    const { kpis, recent } = chainKpis();
    return NextResponse.json({ ok: true, kpis, recent, spec: chainSpec(), at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: { op?: unknown } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const op = String(body.op ?? "");
  try {
    if (op === "drill") {
      const drill = await drillChain();
      return NextResponse.json({ ok: true, drillOk: drill.drillOk, selected: drill.selected, attempts: drill.attempts, note: drill.note, at: new Date().toISOString() });
    }
    if (op === "flush") {
      const spilled = flushFastPath();
      return NextResponse.json({ ok: true, spilled, at: new Date().toISOString() });
    }
    return NextResponse.json({ ok: false, error: "op must be drill or flush" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 500 },
    );
  }
}
