import { describe, it, expect } from "vitest";
import {
  evaluatePolicies,
  DEFAULT_POLICY,
  type PolicyRow,
} from "@/lib/engine/policy";

const withRules = (rules: PolicyRow["rules"], priority = 100): PolicyRow => ({
  id: "p1",
  name: "test",
  enabled: true,
  priority,
  rules,
});

describe("evaluatePolicies", () => {
  it("fails closed: unmatched low risk = auto, higher = human", () => {
    expect(
      evaluatePolicies([], {
        toolName: "x",
        risk: "low",
        agentTier: "engineering",
        arguments: {},
      }).effect,
    ).toBe("auto");
    expect(
      evaluatePolicies([], {
        toolName: "x",
        risk: "medium",
        agentTier: "engineering",
        arguments: {},
      }).effect,
    ).toBe("human");
    expect(
      evaluatePolicies([], {
        toolName: "x",
        risk: "high",
        agentTier: "engineering",
        arguments: {},
      }).effect,
    ).toBe("human");
  });

  it("first matching rule within a policy wins", () => {
    const policy = withRules([
      { if: { toolName: ["deploy"] }, then: "human" },
      { if: { toolName: ["deploy"] }, then: "deny" },
    ]);
    expect(
      evaluatePolicies([policy], {
        toolName: "deploy",
        risk: "high",
        agentTier: "release",
        arguments: {},
      }).effect,
    ).toBe("human");
  });

  it("lower priority number evaluates first across policies", () => {
    const deny = withRules([{ if: { riskAtLeast: "low" }, then: "deny" }], 1);
    const auto = withRules([{ if: { riskAtLeast: "low" }, then: "auto" }], 2);
    expect(
      evaluatePolicies([auto, deny], {
        toolName: "x",
        risk: "low",
        agentTier: "engineering",
        arguments: {},
      }).effect,
    ).toBe("deny");
  });

  it("riskAtLeast does not match a lower risk (high rule vs medium action)", () => {
    const policy = withRules([{ if: { riskAtLeast: "high" }, then: "deny" }]);
    // medium < high so the rule does not fire; low-risk action would auto,
    // but medium falls through to the fail-closed human default.
    expect(
      evaluatePolicies([policy], {
        toolName: "x",
        risk: "low",
        agentTier: "engineering",
        arguments: {},
      }).effect,
    ).toBe("auto");
  });

  it("medium risk with no match returns human (fail-closed)", () => {
    const policy = withRules([{ if: { riskAtLeast: "high" }, then: "deny" }]);
    expect(
      evaluatePolicies([policy], {
        toolName: "x",
        risk: "medium",
        agentTier: "engineering",
        arguments: {},
      }).effect,
    ).toBe("human");
  });

  it("argMatches applies a regex against a dot-path arg", () => {
    const policy = withRules([
      {
        if: { argMatches: [{ path: "environment", regex: "^prod" }] },
        then: "human",
      },
    ]);
    expect(
      evaluatePolicies([policy], {
        toolName: "deploy",
        risk: "low",
        agentTier: "release",
        arguments: { environment: "production" },
      }).effect,
    ).toBe("human");
    expect(
      evaluatePolicies([policy], {
        toolName: "deploy",
        risk: "low",
        agentTier: "release",
        arguments: { environment: "staging" },
      }).effect,
    ).toBe("auto");
  });

  it("disabled policies are skipped", () => {
    const policy = { ...withRules([{ if: {}, then: "deny" as const }]), enabled: false };
    expect(
      evaluatePolicies([policy], {
        toolName: "x",
        risk: "low",
        agentTier: "engineering",
        arguments: {},
      }).effect,
    ).toBe("auto");
  });

  it("DEFAULT_POLICY routes simulate_deploy and high risk to human", () => {
    const policy = withRules(DEFAULT_POLICY.rules, DEFAULT_POLICY.priority);
    expect(
      evaluatePolicies([policy], {
        toolName: "simulate_deploy",
        risk: "high",
        agentTier: "release",
        arguments: {},
      }).effect,
    ).toBe("human");
    expect(
      evaluatePolicies([policy], {
        toolName: "calculator",
        risk: "low",
        agentTier: "engineering",
        arguments: {},
      }).effect,
    ).toBe("auto");
  });
});
