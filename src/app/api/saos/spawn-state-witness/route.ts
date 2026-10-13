import { NextResponse } from "next/server";
import { ensureStateWitnessAlive } from "@/lib/state-witness-organ";

export const dynamic = "force-dynamic";

/* R273-b: explicit implantation of the state-witness organ (:3046), mirror of
 * spawn-metrics (R218-a) / spawn-dev-keeper (R262). Idempotent, single-instance
 * law, refused-when-healthy. The witness watches the engine state dir and
 * serves /eats (what consumed what) — the crash-forensics eye. Measured gap
 * in R273-b: it died with the crash and nothing re-spawned it; this route +
 * connector close that class. */

export async function POST() {
  const res = await ensureStateWitnessAlive();
  return NextResponse.json({
    ok: res.alive,
    verdict: res.action,
    pid: res.pid ?? null,
    organ: "state-witness",
    port: 3046,
  });
}
