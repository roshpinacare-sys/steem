import { describe, expect, it } from "vitest";
import { assessSovereignty } from "@/lib/sovereignty/assessment";
import type { SovereigntyDependency, SovereigntyVector } from "@/lib/sovereignty/types";

const vector: SovereigntyVector = {
  compute: 80,
  model: 75,
  data: 90,
  memory: 85,
  identity: 80,
  tools: 85,
  network: 80,
  updates: 75,
  supplyChain: 70,
  recovery: 90,
  operations: 75,
  energy: 60,
  governance: 85,
};

function dependency(overrides: Partial<SovereigntyDependency> = {}): SovereigntyDependency {
  return {
    id: "local-db",
    name: "Local DB",
    purpose: "storage",
    phase: "runtime",
    locality: "local_authoritative",
    mandatory: true,
    networkRequired: false,
    authenticationRequired: false,
    dataSentExternally: [],
    integrityMethod: "hash",
    failureBehavior: "fail_closed",
    sovereigntyImpact: "local",
    evidence: ["test"],
    ...overrides,
  };
}

describe("sovereignty assessment", () => {
  it("keeps unknown evidence blocking", () => {
    const result = assessSovereignty({ vector, dependencies: [dependency()], requiredEvidence: { zeroKey: true, signedUpdate: undefined } });
    expect(result.level).toBe("sovereign_development_mode");
    expect(result.evidenceUnknown).toEqual(["signedUpdate"]);
  });

  it("detects mandatory remote dependencies as fatal", () => {
    const result = assessSovereignty({ vector, dependencies: [dependency({ id: "remote-auth", locality: "remote_required", networkRequired: true })] });
    expect(result.fatalWeaknesses).toContain("mandatory_external_dependency");
    expect(result.level).toBe("partially_sovereign");
  });
});
