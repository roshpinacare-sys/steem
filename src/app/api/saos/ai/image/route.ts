import { NextResponse } from "next/server";
import { guardAiBridge, shieldReject } from "@/lib/exposureShield";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * T-46 · IMAGE BRIDGE (engine-called, backend-only law) — the first
 * POWER-LADDER rung (T-33-NEXT): image-search rail for the content team.
 *
 * The engine's digest round calls this ONCE with a topical query; the SDK's
 * in-house image search returns OSS-rehosted, embeddable URLs. The ENGINE
 * decides: withBannerImage applies the scheme law (https only, no
 * whitespace), builds a digits-free attribution, and the SAME sanitize laws
 * re-judge the whole body before anything queues. This route only speaks
 * "search" — it never edits a draft.
 *
 * Response shape (success): { ok, results: [{url, caption, source}] }
 * Failure is honest: { ok:false, error } with 502 — a digest without a
 * banner still queues (the banner is a rung, not a law).
 */
export async function POST(req: Request) {
  /* T-35 EXPOSURE SHIELD: same law as every AI bridge — same-origin (browser)
   * or token-carried (engine) only, never public */
  const refused = shieldReject(guardAiBridge(req));
  if (refused) return refused;
  let body: { query?: unknown; num?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body → default query */ }
  const query = typeof body.query === "string" && body.query.trim().length > 2
    ? body.query.trim().slice(0, 200)
    : "abstract blockchain network technology illustration";
  const count = Math.min(4, Math.max(1, Number(body.num) || 2));
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const res = await zai.images.search.create({ query, count, gl: "us", rank: false });
    if (res && (res as { success?: boolean }).success === false) {
      throw new Error(String((res as { error?: string }).error || "image search failed"));
    }
    const results = (res as { results?: Array<{ original_url?: string; caption?: string; source?: string }> })?.results ?? [];
    return NextResponse.json({
      ok: true,
      query,
      count: results.length,
      results: results
        .filter((r) => typeof r?.original_url === "string" && r.original_url.length > 0)
        .slice(0, count)
        .map((r) => ({ url: r.original_url, caption: String(r?.caption ?? "").slice(0, 200), source: String(r?.source ?? "") })),
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, query, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
