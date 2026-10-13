import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * T-75 · THIN PROXY to the network DEX service (mini-services/saos-dex :3037).
 * One-body law: this route only RENDERS the DEX service's own truth — no
 * domain logic here. Service down → last-good STALE-marked, never
 * re-measured, never faked.
 */
const DEX_HTTP = "http://127.0.0.1:3037";
const CACHE_TTL_MS = 45_000;
let cache: { at: number; data: unknown; good: boolean } | null = null;

async function dexStatus(): Promise<{ up: boolean; data: Record<string, unknown> | null }> {
  try {
    const r = await fetch(`${DEX_HTTP}/status`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!r.ok) return { up: false, data: null };
    return { up: true, data: (await r.json()) as Record<string, unknown> };
  } catch {
    return { up: false, data: null };
  }
}

export async function GET() {
  if (cache && cache.good && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  const { up, data } = await dexStatus();
  if (!up || !data) {
    if (cache?.good) {
      const stale = { ...(cache.data as Record<string, unknown>), stale: true };
      return NextResponse.json(stale);
    }
    return NextResponse.json(
      {
        ok: false, asof: new Date().toISOString(), service: { up: false },
        notes: ["שירות-ה-DEX אינו זמין — אין מדידה-עוקפת-שירות (חוק-הגוף-האחד)"],
      },
      { status: 503 }
    );
  }
  cache = { at: Date.now(), data, good: true };
  return NextResponse.json(data);
}
