import { NextResponse } from "next/server";
import { runLlmChain } from "@/lib/llm-chain";

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
    /* R285 · THE CHAIN: search rides the candidate chain too. primary asks
     * for the full num; sparse-retry is a genuinely different request (a
     * narrower result set) that survives throttled weather. The fast path
     * serves the exact query within its TTL without burning the provider. */
    const search = (n: number) =>
      zai.functions.invoke("web_search", { query, num: n }).then((results: unknown) => {
        if (!Array.isArray(results)) throw new Error("search returned non-array");
        if (!results.length) throw new Error("empty search results");
        return {
          value: results.map((r: { url?: string; name?: string; snippet?: string; host_name?: string; date?: string }) => ({
            url: r?.url ?? null,
            name: r?.name ?? null,
            snippet: r?.snippet ?? null,
            host_name: r?.host_name ?? null,
            date: r?.date ?? null,
          })),
          tokens: 0,
        };
      });
    const chain = await runLlmChain<Record<string, unknown>[]>({
      purpose: "webintel",
      candidates: [
        { name: "primary", call: () => search(num) },
        { name: "sparse-retry", call: () => search(Math.min(3, num)) },
      ],
      timeoutMs: 25_000,
      cacheKey: `webintel|${query}|${num}`,
    });
    if (!chain.ok || !chain.output) {
      return NextResponse.json(
        { ok: false, query, error: `llm-chain exhausted (${chain.errorClass ?? "unknown"})`, chain: { attempts: chain.attempts, ms: chain.ms } },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      query,
      count: chain.output.length,
      results: chain.output,
      chain: { selected: chain.selected, attempts: chain.attempts, cacheHit: chain.cacheHit, ms: chain.ms },
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, query, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
