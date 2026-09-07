import { NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq, or } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { appendAudit } from "@/lib/engine/audit";
import { isSafeRegex } from "@/lib/security/safe-regex";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";

export const runtime = "nodejs";

const ruleSchema = z.object({
  if: z.object({
    toolName: z.array(z.string()).optional(),
    riskAtLeast: z.enum(["low", "medium", "high"]).optional(),
    agentTier: z.array(z.string()).optional(),
    argMatches: z
      .array(
        z.object({
          path: z.string().min(1).max(120),
          regex: z.string().min(1).max(160).refine(isSafeRegex, "unsafe_regex"),
        }),
      )
      .max(16)
      .optional(),
  }),
  then: z.enum(["auto", "human", "deny"]),
  reason: z.string().optional(),
});

const patchSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  rules: z.array(ruleSchema).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const scope = resolvePilotScope(session.user.id);
  const rows = db
    .select()
    .from(schema.policies)
    .where(
      session.user.role === "admin"
        ? undefined
        : or(
            eq(schema.policies.isBuiltin, true),
            and(
              eq(schema.policies.ownerId, session.user.id),
              eq(schema.policies.tenantId, scope.tenantId),
              eq(schema.policies.workspaceId, scope.workspaceId),
            ),
          ),
    )
    .orderBy(asc(schema.policies.priority))
    .all();
  return NextResponse.json({ policies: rows });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  const d = parsed.data;
  const scope = resolvePilotScope(session.user.id);
  const existing = db
    .select({
      ownerId: schema.policies.ownerId,
      isBuiltin: schema.policies.isBuiltin,
      tenantId: schema.policies.tenantId,
      workspaceId: schema.policies.workspaceId,
    })
    .from(schema.policies)
    .where(eq(schema.policies.id, d.id))
    .get();
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const mayEdit = existing.isBuiltin
    ? session.user.role === "admin"
    : (existing.ownerId === session.user.id || session.user.role === "admin") &&
      existing.tenantId === scope.tenantId &&
      existing.workspaceId === scope.workspaceId;
  if (!mayEdit) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (d.name !== undefined) patch.name = d.name;
  if (d.enabled !== undefined) patch.enabled = d.enabled;
  if (d.priority !== undefined) patch.priority = d.priority;
  if (d.rules !== undefined) patch.rules = d.rules;

  db.update(schema.policies)
    .set(patch)
    .where(eq(schema.policies.id, d.id))
    .run();
  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "policy.update",
    subjectType: "policy",
    subjectId: d.id,
  });
  return NextResponse.json({ ok: true });
}
