import { describe, expect, it } from "vitest";
import { decideResourceAccess } from "@/lib/auth/authorization";

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("pilot tenant and workspace isolation", () => {
  it("denies every generated cross-tenant or cross-workspace private access", () => {
    const random = rng(0x13cafe);
    for (let index = 0; index < 1_000; index += 1) {
      const owner = `user-${Math.floor(random() * 20)}`;
      const principalTenant = `tenant-${Math.floor(random() * 8)}`;
      const resourceTenant = index % 2 === 0 ? `${principalTenant}-other` : principalTenant;
      const principalWorkspace = `workspace-${Math.floor(random() * 8)}`;
      const resourceWorkspace = index % 2 === 1 ? `${principalWorkspace}-other` : principalWorkspace;
      const decision = decideResourceAccess(
        { id: owner, role: "member", tenantId: principalTenant, workspaceId: principalWorkspace },
        {
          ownerId: owner,
          tenantId: resourceTenant,
          workspaceId: resourceWorkspace,
          visibility: "private",
        },
        "read",
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reasons.some((reason) => reason.includes("scope_mismatch"))).toBe(true);
    }
  });

  it("does not let public visibility bypass a tenant mismatch", () => {
    const decision = decideResourceAccess(
      { id: "user-a", role: "member", tenantId: "tenant-a", workspaceId: "workspace-a" },
      { ownerId: "user-b", tenantId: "tenant-b", workspaceId: "workspace-b", visibility: "public" },
      "read",
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("tenant_scope_mismatch");
  });
});
