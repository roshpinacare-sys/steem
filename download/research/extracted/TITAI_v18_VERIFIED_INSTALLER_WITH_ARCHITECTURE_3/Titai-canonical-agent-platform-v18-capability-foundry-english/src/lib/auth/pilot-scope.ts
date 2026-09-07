import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/db/schema";

export interface PilotScope {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export function personalTenantId(userId: string): string {
  return `tenant-${userId}`;
}

export function personalWorkspaceId(userId: string): string {
  return `workspace-${userId}`;
}

export function ensurePersonalPilotScope(userId: string): PilotScope {
  if (!userId.trim()) throw new Error("pilot_user_required");
  const tenantId = personalTenantId(userId);
  const workspaceId = personalWorkspaceId(userId);
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) throw new Error("pilot_user_not_found");

  db.$client.transaction(() => {
    db.insert(schema.tenants)
      .values({ id: tenantId, name: `${user.name} Personal Tenant`, createdAt: user.createdAt ?? new Date() })
      .onConflictDoNothing({ target: schema.tenants.id })
      .run();
    db.insert(schema.workspaces)
      .values({ id: workspaceId, tenantId, name: "Primary Workspace", createdAt: user.createdAt ?? new Date() })
      .onConflictDoNothing({ target: schema.workspaces.id })
      .run();
    db.insert(schema.workspaceMemberships)
      .values({
        userId,
        tenantId,
        workspaceId,
        role: user.role === "admin" ? "owner" : "operator",
        createdAt: user.createdAt ?? new Date(),
      })
      .onConflictDoNothing({
        target: [schema.workspaceMemberships.userId, schema.workspaceMemberships.workspaceId],
      })
      .run();
  }).immediate();

  const membership = db
    .select()
    .from(schema.workspaceMemberships)
    .where(
      and(
        eq(schema.workspaceMemberships.userId, userId),
        eq(schema.workspaceMemberships.workspaceId, workspaceId),
      ),
    )
    .get();
  if (!membership) throw new Error("pilot_membership_creation_failed");
  return { tenantId, workspaceId, userId, role: membership.role };
}

export function resolvePilotScope(
  userId: string,
  requested?: { tenantId?: string; workspaceId?: string },
): PilotScope {
  if (!requested?.tenantId && !requested?.workspaceId) return ensurePersonalPilotScope(userId);
  if (!requested.tenantId || !requested.workspaceId) throw new Error("pilot_scope_incomplete");
  const membership = db
    .select()
    .from(schema.workspaceMemberships)
    .where(
      and(
        eq(schema.workspaceMemberships.userId, userId),
        eq(schema.workspaceMemberships.tenantId, requested.tenantId),
        eq(schema.workspaceMemberships.workspaceId, requested.workspaceId),
      ),
    )
    .get();
  if (!membership) throw new Error("pilot_scope_denied");
  return {
    userId,
    tenantId: membership.tenantId,
    workspaceId: membership.workspaceId,
    role: membership.role,
  };
}

export function assertScopeMatch(
  scope: Pick<PilotScope, "tenantId" | "workspaceId">,
  resource: { tenantId?: string | null; workspaceId?: string | null },
): void {
  if (!resource.tenantId || !resource.workspaceId) throw new Error("resource_scope_missing");
  if (resource.tenantId !== scope.tenantId) throw new Error("tenant_scope_mismatch");
  if (resource.workspaceId !== scope.workspaceId) throw new Error("workspace_scope_mismatch");
}
