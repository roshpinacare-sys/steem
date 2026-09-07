import { describe, expect, it } from "vitest";
import { decideToolCapability } from "@/lib/engine/tool-capability";
import { getTool } from "@/lib/engine/tools";

describe("tool capability broker", () => {
  it("denies a registered tool that is not in the agent allowlist", () => {
    const tool = getTool("simulate_deploy")!;
    const decision = decideToolCapability({
      tool,
      allowedTools: ["calculator"],
      dryRun: false,
      hasHumanApproval: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("tool_not_in_agent_allowlist");
  });

  it("requires human approval for a high-risk capability", () => {
    const tool = getTool("simulate_deploy")!;
    const decision = decideToolCapability({
      tool,
      allowedTools: [tool.name],
      dryRun: false,
      hasHumanApproval: false,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requirements).toContain("human_approval");
  });

  it("blocks network tools when the task scope denies network", () => {
    const tool = getTool("http_fetch")!;
    const decision = decideToolCapability({
      tool,
      allowedTools: [tool.name],
      dryRun: false,
      hasHumanApproval: false,
      allowNetwork: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("network_capability_not_granted");
  });
});
