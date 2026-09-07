import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { computeOperationalMetrics } from "@/lib/observability/metrics";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const runs = session.user.role === "admin"
    ? db.select().from(schema.runs).all()
    : db.select().from(schema.runs).where(eq(schema.runs.userId, session.user.id)).all();
  const runIds = new Set(runs.map((run) => run.id));
  const approvalStatuses = db
    .select({ runId: schema.approvals.runId, status: schema.approvals.status })
    .from(schema.approvals)
    .all()
    .filter((row) => session.user.role === "admin" || runIds.has(row.runId))
    .map((row) => row.status);
  const outboxStatuses = session.user.role === "admin"
    ? db.select({ status: schema.durableOutbox.status }).from(schema.durableOutbox).all().map((row) => row.status)
    : [];
  const durableJobStatuses = session.user.role === "admin"
    ? db.select({ status: schema.durableJobs.status }).from(schema.durableJobs).all().map((row) => row.status)
    : [];
  return NextResponse.json(
    computeOperationalMetrics({ runs, approvalStatuses, outboxStatuses, durableJobStatuses }),
    { headers: { "cache-control": "no-store" } },
  );
}
