/**
 * TFA Evolution Studio v28 — RBAC (Role-Based Access Control)
 *
 * Defines the platform's permission model:
 *   - Roles: owner > admin > developer > reviewer > observer
 *   - Permissions: fine-grained action rights
 *   - Risk classifications: gate high-risk operations behind approval
 *
 * Usage:
 *   assertPermission(role, "release.publish")  // throws if not allowed
 *   hasPermission(role, "job.run")             // boolean check
 *   operationRiskLevel("release.publish")      // → "critical"
 */

import type { Role, Permission, RiskLevel } from "@/lib/types";
import { recordAudit } from "./audit-trail";

// ── Role hierarchy ─────────────────────────────────────────────────────────

const ROLE_RANK: Record<Role, number> = {
  owner: 100,
  admin: 80,
  developer: 60,
  reviewer: 40,
  observer: 20,
};

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

// ── Permission → minimum role mapping ────────────────────────────────────

const PERMISSION_MIN_ROLE: Record<Permission, Role> = {
  "project.create": "developer",
  "project.delete": "admin",
  "job.run": "developer",
  "job.cancel": "developer",
  "release.publish": "admin",
  "release.approve": "admin",
  "governance.approve": "reviewer",
  "governance.view": "observer",
  "audit.view": "reviewer",
  "adapter.register": "admin",
  "automation.manage": "admin",
};

// ── Permission / risk level classification ────────────────────────────────

const PERMISSION_RISK: Record<Permission, RiskLevel> = {
  "project.create": "low",
  "project.delete": "high",
  "job.run": "low",
  "job.cancel": "medium",
  "release.publish": "critical",
  "release.approve": "critical",
  "governance.approve": "high",
  "governance.view": "low",
  "audit.view": "low",
  "adapter.register": "high",
  "automation.manage": "high",
};

// ── Permissions that always require an approval gate ─────────────────────

const ALWAYS_GATE: Set<Permission> = new Set([
  "release.publish",
  "project.delete",
  "adapter.register",
]);

// ── Core RBAC functions ────────────────────────────────────────────────────

export function hasPermission(role: Role, permission: Permission): boolean {
  const minRole = PERMISSION_MIN_ROLE[permission];
  if (!minRole) return false;
  return roleAtLeast(role, minRole);
}

/**
 * Assert that actor has the required permission.
 * Records an audit entry on failure.
 * Throws AccessDeniedError if permission is not held.
 */
export function assertPermission(
  actor: string,
  role: Role,
  permission: Permission,
  projectId?: string
): void {
  if (!hasPermission(role, permission)) {
    recordAudit(actor, `permission_denied:${permission}`, permission, projectId, {
      role,
      outcome: "blocked",
    });
    throw new AccessDeniedError(
      `Actor "${actor}" with role "${role}" does not have permission "${permission}".`
    );
  }
}

export function operationRiskLevel(permission: Permission): RiskLevel {
  return PERMISSION_RISK[permission] ?? "medium";
}

export function requiresApprovalGate(permission: Permission): boolean {
  return ALWAYS_GATE.has(permission);
}

// ── Permission listing helpers ────────────────────────────────────────────

export function getPermissionsForRole(role: Role): Permission[] {
  return (Object.keys(PERMISSION_MIN_ROLE) as Permission[]).filter((p) =>
    hasPermission(role, p)
  );
}

export function getRolesWithPermission(permission: Permission): Role[] {
  return (Object.keys(ROLE_RANK) as Role[]).filter((r) => hasPermission(r, permission));
}

// ── Role derivation from context ──────────────────────────────────────────

/**
 * Derive a safe default role for an actor that has no explicit assignment.
 * Default is "observer" — least privilege.
 */
export function resolveRole(explicitRole?: string): Role {
  const valid: Role[] = ["owner", "admin", "developer", "reviewer", "observer"];
  if (explicitRole && valid.includes(explicitRole as Role)) {
    return explicitRole as Role;
  }
  return "observer";
}

// ── Error type ─────────────────────────────────────────────────────────────

export class AccessDeniedError extends Error {
  readonly code = "ACCESS_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}
