import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, desc, inArray, or, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getAgent } from "@/lib/db/queries/agents";
import { appendAudit } from "@/lib/engine/audit";
import { TIERS, PROVIDERS } from "@/lib/constants";
import { ALL_TOOL_NAMES } from "@/lib/engine/tools";
import { createId } from "@/lib/ids";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  tier: z.enum(TIERS as [string, ...string[]]).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  // Saving these creates a NEW version.
  version: z
    .object({
      systemPrompt: z.string().max(8000),
      provider: z.enum(PROVIDERS as [string, ...string[]]),
      model: z.string().max(120),
      temperature: z.number().min(0).max(2),
      maxSteps: z.number().int().min(1).max(20),
      maxToolIterations: z.number().int().min(1).max(20),
      tools: z.array(z.string()),
    })
    .optional(),
  skillIds: z.array(z.string()).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { agentId } = await params;
  const agent = getAgent(session.user.id, agentId);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const versions = db
    .select()
    .from(schema.agentVersions)
    .where(eq(schema.agentVersions.agentId, agentId))
    .orderBy(desc(schema.agentVersions.version))
    .all();
  const skillLinks = db
    .select()
    .from(schema.agentSkills)
    .where(eq(schema.agentSkills.agentId, agentId))
    .all();
  return NextResponse.json({ agent, versions, skillLinks });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { agentId } = await params;
  const agent = getAgent(session.user.id, agentId);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  const d = parsed.data;

  const agentPatch: Record<string, unknown> = { updatedAt: new Date() };
  if (d.name !== undefined) agentPatch.name = d.name;
  if (d.description !== undefined) agentPatch.description = d.description;
  if (d.tier !== undefined) agentPatch.tier = d.tier;
  if (d.status !== undefined) agentPatch.status = d.status;

  let newVersion: number | undefined;
  if (d.version) {
    const latest = db
      .select({ v: schema.agentVersions.version })
      .from(schema.agentVersions)
      .where(eq(schema.agentVersions.agentId, agentId))
      .orderBy(desc(schema.agentVersions.version))
      .get();
    newVersion = (latest?.v ?? 0) + 1;
    const versionId = createId();
    db.insert(schema.agentVersions)
      .values({
        id: versionId,
        agentId,
        version: newVersion,
        systemPrompt: d.version.systemPrompt,
        provider: d.version.provider as never,
        model: d.version.model,
        temperature: d.version.temperature,
        maxSteps: d.version.maxSteps,
        maxToolIterations: d.version.maxToolIterations,
        tools: d.version.tools.filter((t) => ALL_TOOL_NAMES.includes(t)),
        createdBy: session.user.id,
      })
      .run();
    agentPatch.currentVersionId = versionId;
  }

  db.update(schema.agents)
    .set(agentPatch)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, session.user.id)))
    .run();

  if (d.skillIds) {
    const uniqueSkillIds = [...new Set(d.skillIds)];
    const allowedSkills = uniqueSkillIds.length
      ? db
          .select({ id: schema.skills.id })
          .from(schema.skills)
          .where(
            and(
              inArray(schema.skills.id, uniqueSkillIds),
              or(
                isNull(schema.skills.ownerId),
                eq(schema.skills.ownerId, session.user.id),
              ),
            ),
          )
          .all()
      : [];
    if (allowedSkills.length !== uniqueSkillIds.length) {
      return NextResponse.json({ error: "invalid_skill_access" }, { status: 403 });
    }
    db.transaction((tx) => {
      tx.delete(schema.agentSkills)
        .where(eq(schema.agentSkills.agentId, agentId))
        .run();
      for (const skillId of uniqueSkillIds) {
        tx.insert(schema.agentSkills)
          .values({ agentId, skillId, pinnedVersionId: null })
          .onConflictDoNothing()
          .run();
      }
    });
  }

  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "agent.update",
    subjectType: "agent",
    subjectId: agentId,
    payload: { newVersion },
  });

  return NextResponse.json({ ok: true, version: newVersion });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { agentId } = await params;
  const agent = getAgent(session.user.id, agentId);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  db.delete(schema.agents).where(eq(schema.agents.id, agentId)).run();
  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "agent.delete",
    subjectType: "agent",
    subjectId: agentId,
  });
  return NextResponse.json({ ok: true });
}
