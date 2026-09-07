export type PrincipalRole = "admin" | "member" | "agent" | "worker" | "verifier" | "service";

export interface AuthorizationPrincipal {
  id: string;
  role: PrincipalRole;
  tenantId?: string;
  workspaceId?: string;
  disabled?: boolean;
}

export interface OwnedResourceScope {
  ownerId?: string | null;
  tenantId?: string | null;
  workspaceId?: string | null;
  builtin?: boolean;
  visibility?: "private" | "workspace" | "tenant" | "public";
}

export type ResourceAction = "read" | "create" | "update" | "delete" | "approve" | "execute" | "verify" | "export" | "restore";

export interface AuthorizationDecision {
  allowed: boolean;
  reasons: string[];
}

export function decideResourceAccess(
  principal: AuthorizationPrincipal,
  resource: OwnedResourceScope,
  action: ResourceAction,
): AuthorizationDecision {
  const reasons: string[] = [];
  if (!principal.id) reasons.push("principal_identity_required");
  if (principal.disabled) reasons.push("principal_disabled");

  if (resource.tenantId && principal.tenantId !== resource.tenantId) {
    reasons.push("tenant_scope_mismatch");
  }
  if (resource.workspaceId && principal.workspaceId !== resource.workspaceId) {
    reasons.push("workspace_scope_mismatch");
  }

  const publicRead = action === "read" && resource.visibility === "public";
  const builtinRead = action === "read" && resource.builtin === true;
  const ownerMatch = !!resource.ownerId && resource.ownerId === principal.id;
  const administrator = principal.role === "admin";

  if (!publicRead && !builtinRead && !ownerMatch && !administrator) {
    reasons.push("resource_not_owned");
  }

  if (action === "verify" && principal.role !== "verifier" && principal.role !== "admin") {
    reasons.push("verifier_role_required");
  }
  if (action === "restore" && principal.role !== "admin") {
    reasons.push("administrator_role_required");
  }
  if (action === "approve" && !["member", "admin"].includes(principal.role)) {
    reasons.push("human_approval_role_required");
  }

  return { allowed: reasons.length === 0, reasons };
}

export function assertResourceAccess(
  principal: AuthorizationPrincipal,
  resource: OwnedResourceScope,
  action: ResourceAction,
): void {
  const decision = decideResourceAccess(principal, resource, action);
  if (!decision.allowed) {
    throw new Error(`authorization_denied:${action}:${decision.reasons.join(",")}`);
  }
}

export function assertIndependentVerifier(builderIdentity: string, verifierIdentity: string): void {
  if (!builderIdentity.trim() || !verifierIdentity.trim()) {
    throw new Error("verification_identity_required");
  }
  if (builderIdentity === verifierIdentity) {
    throw new Error("verification_identity_collision");
  }
}
