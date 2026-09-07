import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, inArray, or } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { appendAudit } from "@/lib/engine/audit";
import { createId } from "@/lib/ids";
import { runManager } from "@/lib/engine/runner";

export const runtime = "nodejs";

const bodySchema = z.object({
  password: z.string().min(1).max(200),
  confirmation: z.literal("DELETE MY TITAI ACCOUNT"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const userId = session.user.id;
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 403 });
  }

  const runs = db
    .select({ id: schema.runs.id, status: schema.runs.status })
    .from(schema.runs)
    .where(eq(schema.runs.userId, userId))
    .all();
  for (const run of runs) {
    if (["queued", "running", "awaiting_approval"].includes(run.status)) {
      await runManager.cancelRun(run.id, userId).catch(() => false);
    }
  }

  const ownedAgents = db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.ownerId, userId)).all();
  const ownedSkills = db.select({ id: schema.skills.id }).from(schema.skills).where(eq(schema.skills.ownerId, userId)).all();
  const ownedMemories = db.select({ id: schema.memories.id }).from(schema.memories).where(eq(schema.memories.ownerId, userId)).all();
  const ownedPolicies = db.select({ id: schema.policies.id }).from(schema.policies).where(eq(schema.policies.ownerId, userId)).all();
  const ownedTemplates = db.select({ id: schema.templates.id }).from(schema.templates).where(eq(schema.templates.ownerId, userId)).all();
  const subjectIds = [
    userId,
    ...runs.map((row) => row.id),
    ...ownedAgents.map((row) => row.id),
    ...ownedSkills.map((row) => row.id),
    ...ownedMemories.map((row) => row.id),
    ...ownedPolicies.map((row) => row.id),
    ...ownedTemplates.map((row) => row.id),
  ];

  appendAudit({
    actorType: "user",
    actorId: userId,
    action: "user.delete",
    subjectType: "user",
    subjectId: userId,
    payload: { scope: "owned-data", auditRetention: "redacted-overlay" },
  });

  const deletion = db.$client.transaction(() => {
    const auditRows = db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(
        or(
          eq(schema.auditLog.actorId, userId),
          inArray(schema.auditLog.subjectId, subjectIds),
        ),
      )
      .all();
    const redactedAt = new Date();
    for (const row of auditRows) {
      db.insert(schema.auditRedactions)
        .values({
          id: createId(),
          auditId: row.id,
          reason: "user_erasure_request",
          redactedAt,
        })
        .onConflictDoNothing({ target: schema.auditRedactions.auditId })
        .run();
    }
    const runIds = runs.map((row) => row.id);
    if (runIds.length) {
      db.delete(schema.durableOutbox)
        .where(
          or(
            inArray(schema.durableOutbox.aggregateId, runIds),
            inArray(schema.durableOutbox.aggregateId, subjectIds),
          ),
        )
        .run();
    }
    db.delete(schema.users).where(eq(schema.users.id, userId)).run();
    return { redactedAuditRows: auditRows.length };
  });
  const result = deletion.immediate();
  return NextResponse.json({ ok: true, ...result });
}
