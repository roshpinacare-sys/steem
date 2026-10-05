import { NextResponse } from "next/server";
import { ensureMetricsAlive, fetchAudit } from "@/lib/metrics-organ";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* R218-b: claims-audit read/force API — mirrors /api/saos/metrics doctrine:
 * demand-heal the organ, then proxy the audit. Honest verdicts only. */

export async function GET() {
  const ensured = await ensureMetricsAlive();
  if (!ensured.alive) {
    return NextResponse.json(
      { ok: false, verdict: "ORGAN-DOWN", note: "איבר-המדדים (:3042) כבוי — אין ביקורת מזויפת" },
      { status: 503 }
    );
  }
  const audit = await fetchAudit(false);
  if (!audit) {
    return NextResponse.json(
      { ok: false, verdict: "AUDIT-UNRESPONSIVE", note: "האיבר חי אך הביקורת לא הושלמה בזמן — נסה שוב" },
      { status: 503 }
    );
  }
  return NextResponse.json(audit);
}

export async function POST() {
  const ensured = await ensureMetricsAlive();
  if (!ensured.alive) {
    return NextResponse.json(
      { ok: false, verdict: "ORGAN-DOWN", note: "איבר-המדדים (:3042) כבוי — אין ביקורת מזויפת" },
      { status: 503 }
    );
  }
  const audit = await fetchAudit(true);
  if (!audit) {
    return NextResponse.json(
      { ok: false, verdict: "AUDIT-UNRESPONSIVE", note: "הרצה-כפויה לא הושלמה בזמן — נסה שוב" },
      { status: 503 }
    );
  }
  return NextResponse.json(audit);
}
