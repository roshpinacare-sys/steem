import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * T-16 · paste-revival proxy: the cockpit's fastest path back to a living
 * signing fleet. The secret travels only: browser → this route → engine
 * (127.0.0.1:3040) → 0600 file in .secrets/. It is NEVER logged, cached, or
 * echoed by this layer. The engine validates the shape, secures the file,
 * and chain-verifies the derived keys against the account's own authorities
 * BEFORE answering. Rate limiting lives engine-side (5/hour).
 */
const ENGINE_HTTP = "http://127.0.0.1:3040";

export async function POST(req: Request) {
  let body: { text?: unknown } = {};
  try {
    body = (await req.json()) as { text?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 });
  }
  try {
    const r = await fetch(`${ENGINE_HTTP}/adopt-credential`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: String(body.text ?? "") }),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    const j = (await r.json()) as Record<string, unknown>;
    return NextResponse.json(j, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `engine unreachable: ${String((e as Error)?.message ?? e).slice(0, 120)}` },
      { status: 502 }
    );
  }
}
