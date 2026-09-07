import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { computeOperationalMetrics } from "@/lib/observability/metrics";
import { ControlRoom } from "@/components/operations/control-room";

export default async function OperationsPage() {
  const user = await requireUser();
  const runs = user.role === "admin"
    ? db.select().from(schema.runs).all()
    : db.select().from(schema.runs).where(eq(schema.runs.userId, user.id)).all();
  const runIds = new Set(runs.map((run) => run.id));
  const approvalStatuses = db.select({ runId: schema.approvals.runId, status: schema.approvals.status }).from(schema.approvals).all().filter((row) => user.role === "admin" || runIds.has(row.runId)).map((row) => row.status);
  const outboxStatuses = user.role === "admin" ? db.select({ status: schema.durableOutbox.status }).from(schema.durableOutbox).all().map((row) => row.status) : [];
  const durableJobStatuses = user.role === "admin" ? db.select({ status: schema.durableJobs.status }).from(schema.durableJobs).all().map((row) => row.status) : [];
  return <ControlRoom initialMetrics={computeOperationalMetrics({ runs, approvalStatuses, outboxStatuses, durableJobStatuses })} />;
}
