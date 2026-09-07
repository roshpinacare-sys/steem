import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { listAgents } from "@/lib/db/queries/agents";
import { appendAudit } from "@/lib/engine/audit";
import { slugify } from "@/lib/utils";
import { TIERS, DEFAULT_MODELS, PROVIDERS } from "@/lib/constants";
import { ALL_TOOL_NAMES, DEFAULT_AGENT_TOOLS } from "@/lib/engine/tools";
import { createId } from "@/lib/ids";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  tier: z.enum(TIERS as [string, ...string[]]).optional(),
  systemPrompt: z.string().max(8000).optional(),
  provider: z.enum(PROVIDERS as [string, ...string[]]).optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const scope = resolvePilotScope(session.user.id);
  return NextResponse.json({
    agents: listAgents(session.user.id, scope),
    scope: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const scope = resolvePilotScope(session.user.id);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const d = parsed.data;
  const tier = (d.tier ?? "engineering") as (typeof TIERS)[number];
  const provider = (d.provider ?? "simulation") as keyof typeof DEFAULT_MODELS;
  const tools = (d.tools ?? [...DEFAULT_AGENT_TOOLS]).filter((t) =>
    ALL_TOOL_NAMES.includes(t),
  );

  const agentId = createId();
  const versionId = createId();

  db.insert(schema.agents)
    .values({
      id: agentId,
      ownerId: session.user.id,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      visibility: "private",
      name: d.name,
      slug: slugify(d.name),
      description: d.description ?? "",
      tier,
      status: "active",
      currentVersionId: versionId,
    })
    .run();

  db.insert(schema.agentVersions)
    .values({
      id: versionId,
      agentId,
      version: 1,
      systemPrompt:
        d.systemPrompt ?? `You are ${d.name}, a capable AI agent. Complete the objective carefully and produce clear, useful output.`,
      provider,
      model: d.model ?? DEFAULT_MODELS[provider] ?? "",
      tools,
      createdBy: session.user.id,
    })
    .run();

  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "agent.create",
    subjectType: "agent",
    subjectId: agentId,
    payload: { name: d.name, tier },
  });

  return NextResponse.json({ id: agentId });
}
