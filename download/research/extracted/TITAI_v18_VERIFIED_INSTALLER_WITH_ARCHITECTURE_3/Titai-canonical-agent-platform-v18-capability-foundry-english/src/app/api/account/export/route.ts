import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const agents = db.select().from(schema.agents).where(eq(schema.agents.ownerId, userId)).all();
  const agentIds = agents.map((row) => row.id);
  const agentVersions = agentIds.length
    ? db.select().from(schema.agentVersions).where(inArray(schema.agentVersions.agentId, agentIds)).all()
    : [];
  const skills = db.select().from(schema.skills).where(eq(schema.skills.ownerId, userId)).all();
  const skillIds = skills.map((row) => row.id);
  const skillVersions = skillIds.length
    ? db.select().from(schema.skillVersions).where(inArray(schema.skillVersions.skillId, skillIds)).all()
    : [];
  const runs = db.select().from(schema.runs).where(eq(schema.runs.userId, userId)).all();
  const runIds = runs.map((row) => row.id);
  const steps = runIds.length
    ? db.select().from(schema.runSteps).where(inArray(schema.runSteps.runId, runIds)).all()
    : [];
  const events = runIds.length
    ? db.select().from(schema.runEvents).where(inArray(schema.runEvents.runId, runIds)).all()
    : [];
  const approvals = runIds.length
    ? db.select().from(schema.approvals).where(inArray(schema.approvals.runId, runIds)).all()
    : [];
  const artifacts = runIds.length
    ? db.select().from(schema.artifacts).where(inArray(schema.artifacts.runId, runIds)).all()
    : [];
  const memories = db.select().from(schema.memories).where(eq(schema.memories.ownerId, userId)).all();
  const policies = db.select().from(schema.policies).where(eq(schema.policies.ownerId, userId)).all();
  const templates = db.select().from(schema.templates).where(eq(schema.templates.ownerId, userId)).all();
  const providers = db
    .select({
      provider: schema.providerConfigs.provider,
      label: schema.providerConfigs.label,
      baseUrl: schema.providerConfigs.baseUrl,
      defaultModel: schema.providerConfigs.defaultModel,
      enabled: schema.providerConfigs.enabled,
      hasKey: schema.providerConfigs.apiKeyCiphertext,
      updatedAt: schema.providerConfigs.updatedAt,
    })
    .from(schema.providerConfigs)
    .where(eq(schema.providerConfigs.userId, userId))
    .all()
    .map((row) => ({ ...row, hasKey: !!row.hasKey }));

  const payload = {
    format: "titai-user-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      locale: user.locale,
      theme: user.theme,
      createdAt: user.createdAt,
    },
    agents,
    agentVersions,
    skills,
    skillVersions,
    runs,
    steps,
    events,
    approvals,
    artifacts,
    memories,
    policies,
    templates,
    providers,
    exclusions: [
      "Password hashes are never exported.",
      "Provider API key ciphertext is never exported.",
      "Global built-in content and immutable audit-chain rows are not included.",
    ],
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="titai-user-export-${userId}.json"`,
      "cache-control": "no-store",
    },
  });
}
