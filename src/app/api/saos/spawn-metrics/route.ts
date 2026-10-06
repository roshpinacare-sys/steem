import { NextResponse } from "next/server";
import { ensureMetricsAlive } from "@/lib/metrics-organ";

export const dynamic = "force-dynamic";

/* R218-a: explicit implantation of the metrics organ (:3042) — mirror of
 * spawn-custodian. Idempotent, single-instance law, refused-when-healthy.
 * Ongoing supervision is demand-heal via /api/saos/metrics (observability
 * organ — deliberately NOT added to the sovereign watchdog to keep the
 * critical shared file untouched during the multi-agent round). */

export async function POST() {
  const res = await ensureMetricsAlive();
  return NextResponse.json({
    ok: res.alive,
    verdict: res.action,
    pid: res.pid ?? null,
    organ: "saos-metrics",
    port: 3042,
  });
}
