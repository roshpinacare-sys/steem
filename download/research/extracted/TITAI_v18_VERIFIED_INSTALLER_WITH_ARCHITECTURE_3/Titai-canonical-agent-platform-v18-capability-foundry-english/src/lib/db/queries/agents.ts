import "server-only";
import { eq, desc, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Agent, AgentVersion } from "@/lib/db/schema";

export interface AgentScopeFilter { tenantId: string; workspaceId: string }

export function listAgents(ownerId: string, scope?: AgentScopeFilter): Agent[] {
  return db
    .select()
    .from(schema.agents)
    .where(
      scope
        ? and(
            eq(schema.agents.ownerId, ownerId),
            eq(schema.agents.tenantId, scope.tenantId),
            eq(schema.agents.workspaceId, scope.workspaceId),
          )
        : eq(schema.agents.ownerId, ownerId),
    )
    .orderBy(desc(schema.agents.updatedAt))
    .all();
}

export function getAgent(
  ownerId: string,
  agentId: string,
  scope?: AgentScopeFilter,
): Agent | undefined {
  return db
    .select()
    .from(schema.agents)
    .where(
      and(
        eq(schema.agents.id, agentId),
        eq(schema.agents.ownerId, ownerId),
        ...(scope
          ? [
              eq(schema.agents.tenantId, scope.tenantId),
              eq(schema.agents.workspaceId, scope.workspaceId),
            ]
          : []),
      ),
    )
    .get();
}

export function getAgentVersion(id: string): AgentVersion | undefined {
  return db
    .select()
    .from(schema.agentVersions)
    .where(eq(schema.agentVersions.id, id))
    .get();
}

export function listAgentVersions(agentId: string): AgentVersion[] {
  return db
    .select()
    .from(schema.agentVersions)
    .where(eq(schema.agentVersions.agentId, agentId))
    .orderBy(desc(schema.agentVersions.version))
    .all();
}

export function getCurrentVersion(agent: Agent): AgentVersion | undefined {
  if (!agent.currentVersionId) return undefined;
  return getAgentVersion(agent.currentVersionId);
}

export interface AgentSkillLink {
  skillId: string;
  pinnedVersionId: string | null;
}

export function getAgentSkills(agentId: string): AgentSkillLink[] {
  return db
    .select({
      skillId: schema.agentSkills.skillId,
      pinnedVersionId: schema.agentSkills.pinnedVersionId,
    })
    .from(schema.agentSkills)
    .where(eq(schema.agentSkills.agentId, agentId))
    .all();
}
