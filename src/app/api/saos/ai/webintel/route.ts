import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * T-22 · WEB-INTEL BRIDGE (engine-called, backend-only law).
 * The sovereign engine (:3040) calls this route every 6h as its external
 * eyes: one real web search per call (z-ai-web-dev-sdk, server-side only).
 * Results are returned RAW-ish (url/name/snippet/date/host), normalization
 * and the no-source-no-finding law live in the ENGINE's pure core
 * (lib.normalizeWebIntel). One body, one language: this route only speaks
 * "search".
 */
export async function POST(req: Request) {
  let body: { query?: unknown; num?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body → default query */ }
  const query = typeof body.query === "string" && body.query.trim().length > 2
    ? body.query.trim().slice(0, 200)
    : "STEEM blockchain news";
  const num = Math.min(10, Math.max(1, Number(body.num) || 5));
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const results = await zai.functions.invoke("web_search", { query, num });
    if (!Array.isArray(results)) throw new Error("search returned non-array");
    return NextResponse.json({
      ok: true,
      query,
      count: results.length,
      results: results.map((r) => ({
        url: r?.url ?? null,
        name: r?.name ?? null,
        snippet: r?.snippet ?? null,
        host_name: r?.host_name ?? null,
        date: r?.date ?? null,
      })),
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, query, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
