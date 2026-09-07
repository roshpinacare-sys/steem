import { describe, expect, it } from "vitest";
import { assertIndependentVerifier, decideResourceAccess } from "@/lib/auth/authorization";

describe("central authorization decisions", () => {
  it("fails closed across tenant and workspace boundaries", () => {
    const decision = decideResourceAccess(
      { id: "user-a", role: "member", tenantId: "tenant-a", workspaceId: "workspace-a" },
      { ownerId: "user-a", tenantId: "tenant-b", workspaceId: "workspace-a", visibility: "private" },
      "read",
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("tenant_scope_mismatch");
  });

  it("allows public read but never public mutation", () => {
    const principal = { id: "visitor", role: "member" as const };
    const resource = { ownerId: "owner", visibility: "public" as const };
    expect(decideResourceAccess(principal, resource, "read").allowed).toBe(true);
    expect(decideResourceAccess(principal, resource, "update").allowed).toBe(false);
  });

  it("requires explicit verifier separation", () => {
    expect(() => assertIndependentVerifier("agent:builder", "agent:builder")).toThrow("verification_identity_collision");
    expect(() => assertIndependentVerifier("agent:builder", "user:verifier")).not.toThrow();
  });
});
