import { NextResponse } from "next/server";
import { ensureMetricsAlive, fetchSnapshot } from "@/lib/metrics-organ";

export const dynamic = "force-dynamic";

/* R218-a: read API for the metrics time-series (Step 1 of the approved plan).
 * Demand-heal + honest freshness (R217 truth law): ageSec is always surfaced;
 * the cockpit may never present stale data as current. */

export async function GET() {
  const ensured = await ensureMetricsAlive();
  if (!ensured.alive) {
    return NextResponse.json(
      {
        ok: false,
        verdict: "ORGAN-DOWN",
        note: "saos-metrics (:3042) לא עלה גם אחרי ניסיון-השתלה — אין נתונים מזויפים",
        action: ensured.action,
      },
      { status: 503 }
    );
  }
  const snap = await fetchSnapshot();
  if (!snap) {
    return NextResponse.json(
      {
        ok: false,
        verdict: "ORGAN-UNRESPONSIVE",
        note: "האיבר חי אך לא ענה בזמן — ייתכן עומס ראשוני, נסה שוב בעוד רגע",
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, verdict: ensured.action, ...(snap as object) });
}
