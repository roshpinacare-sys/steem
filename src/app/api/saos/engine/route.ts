import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * T-9d · cockpit → sovereign-local engine proxy (127.0.0.1:3040).
 * GET  → engine /status (state files + events)
 * POST → engine /cycle  (run a full observe→tick→peg→convert→report cycle)
 * The engine is KEYLESS by design; this proxy adds no secrets either.
 */
const ENGINE_HTTP = "http://127.0.0.1:3040";

export async function GET() {
  try {
    const r = await fetch(`${ENGINE_HTTP}/status`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, engine: "down", hint: "mini-services/saos-engine not running: start with `bun run dev` in that folder", error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}

export async function POST() {
  try {
    const r = await fetch(`${ENGINE_HTTP}/cycle`, { method: "POST", signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, engine: "down", hint: "engine cycle failed or engine not running", error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
