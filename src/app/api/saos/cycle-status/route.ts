import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * T-17 · cockpit → engine cycle-marker poll (127.0.0.1:3040/cycle-status).
 *
 * The engine acks POST /cycle immediately and runs the cycle detached
 * (single-flight, cycle-run.json marker, try/finally always closes). The
 * cockpit polls THIS route until the marker closes, no UI wait can outlive
 * a healthy signing cycle anymore, and the truth message is built from the
 * ENGINE's own classification (ok | blocked | fail + engine-measured ms).
 * The fresh rollup rides along from daily-report.json so the cockpit can
 * state the measured economics of the cycle that just finished.
 */
const ENGINE_HTTP = "http://127.0.0.1:3040";
const DAILY_REPORT = "/home/z/my-project/mini-services/saos-engine/state/daily-report.json";

export async function GET() {
  try {
    const r = await fetch(`${ENGINE_HTTP}/cycle-status`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    const j = await r.json();
    let rollup: { measuredTotalUsdPerDay?: number | null; realizedSbd?: number | null } | null = null;
    try {
      const report = JSON.parse(await readFile(DAILY_REPORT, "utf8")) as { rollup?: { measuredTotalUsdPerDay?: number | null; realizedSbd?: number | null } | null };
      rollup = report.rollup ?? null;
    } catch { /* no report yet: rollup stays null */ }
    return NextResponse.json(deDashDeep({ ...j, rollup }));
  } catch (e) {
    return NextResponse.json(
      { ok: false, running: false, marker: null, engine: "down", error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
