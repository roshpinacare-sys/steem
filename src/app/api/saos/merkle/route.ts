import { NextResponse } from "next/server";
import { ensureMetricsAlive, fetchMerkle } from "@/lib/metrics-organ";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/* R218-c: merkle event-anchoring API — demand-heal the organ, then proxy.
 * GET = verify from raw bytes; POST = anchor a new batch + verify. */

export async function GET() {
  const ensured = await ensureMetricsAlive();
  if (!ensured.alive) {
    return NextResponse.json(
      { ok: false, verdict: "ORGAN-DOWN", note: "איבר-המדדים (:3042) כבוי — אין אימות מזויף" },
      { status: 503 }
    );
  }
  const merkle = await fetchMerkle(false);
  if (!merkle) {
    return NextResponse.json(
      { ok: false, verdict: "MERKLE-UNRESPONSIVE", note: "האיבר חי אך האימות לא הושלם — נסה שוב" },
      { status: 503 }
    );
  }
  return NextResponse.json(merkle);
}

export async function POST() {
  const ensured = await ensureMetricsAlive();
  if (!ensured.alive) {
    return NextResponse.json(
      { ok: false, verdict: "ORGAN-DOWN", note: "איבר-המדדים (:3042) כבוי — אין אימות מזויף" },
      { status: 503 }
    );
  }
  const merkle = await fetchMerkle(true);
  if (!merkle) {
    return NextResponse.json(
      { ok: false, verdict: "MERKLE-UNRESPONSIVE", note: "עיגון-האצווה לא הושלם — נסה שוב" },
      { status: 503 }
    );
  }
  return NextResponse.json(merkle);
}
