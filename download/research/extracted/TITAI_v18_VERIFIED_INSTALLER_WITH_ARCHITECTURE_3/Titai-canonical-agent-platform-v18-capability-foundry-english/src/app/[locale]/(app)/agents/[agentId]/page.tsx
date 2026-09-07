import { notFound } from "next/navigation";
import { or, isNull, eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getAgent, listAgentVersions, getAgentSkills } from "@/lib/db/queries/agents";
import { db, schema } from "@/lib/db";
import { listTools } from "@/lib/engine/tools";
import { AgentEditor } from "@/components/studio/agent-editor";

export default async function AgentStudioPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const user = await requireUser();
  const { agentId } = await params;
  const agent = getAgent(user.id, agentId);
  if (!agent) notFound();

  const versions = listAgentVersions(agentId);
  const attachedSkillIds = getAgentSkills(agentId).map((l) => l.skillId);
  const allSkills = db
    .select()
    .from(schema.skills)
    .where(or(isNull(schema.skills.ownerId), eq(schema.skills.ownerId, user.id)))
    .orderBy(desc(schema.skills.isBuiltin))
    .all();
  const toolNames = listTools().map((t) => ({
    name: t.name,
    risk: t.risk,
    description: t.description,
  }));

  return (
    <AgentEditor
      agent={agent}
      versions={versions}
      attachedSkillIds={attachedSkillIds}
      allSkills={allSkills}
      toolNames={toolNames}
    />
  );
}
