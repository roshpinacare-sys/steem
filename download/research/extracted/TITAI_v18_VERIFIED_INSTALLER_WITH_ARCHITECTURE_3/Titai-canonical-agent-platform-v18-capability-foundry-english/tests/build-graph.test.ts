import { describe, it, expect } from "vitest";
import { buildRunGraph } from "@/components/canvas/build-graph";
import type { ClientRunEvent } from "@/lib/engine/event-types";

let id = 0;
const ev = (type: string, payload: unknown): ClientRunEvent => ({
  id: ++id,
  seq: id,
  type: type as ClientRunEvent["type"],
  payload,
});

describe("buildRunGraph", () => {
  it("builds agent + step nodes with dependency edges", () => {
    const events = [
      ev("run.started", { agentName: "A", agentTier: "engineering", provider: "simulation" }),
      ev("plan.created", {
        steps: [
          { id: "s1", name: "plan", description: "", dependsOn: [] },
          { id: "s2", name: "build", description: "", dependsOn: ["plan"] },
        ],
      }),
    ];
    const g = buildRunGraph(events);
    expect(g.nodes.find((n) => n.id === "agent")).toBeTruthy();
    expect(g.nodes.filter((n) => n.kind === "step")).toHaveLength(2);
    // agent → s1 (root), s1 → s2 (dependency)
    expect(g.edges).toContainEqual(
      expect.objectContaining({ source: "agent", target: "s1" }),
    );
    expect(g.edges).toContainEqual(
      expect.objectContaining({ source: "s1", target: "s2" }),
    );
  });

  it("splices an approval node and resolves it", () => {
    const events = [
      ev("run.started", { agentName: "A", agentTier: "release" }),
      ev("plan.created", { steps: [{ id: "s1", name: "deploy", description: "", dependsOn: [] }] }),
      ev("step.started", { stepId: "s1" }),
      ev("approval.requested", { approvalId: "ap1", stepId: "s1", toolName: "simulate_deploy", risk: "high" }),
    ];
    let g = buildRunGraph(events);
    const approval = g.nodes.find((n) => n.kind === "approval");
    expect(approval?.status).toBe("awaiting");

    const resolved = buildRunGraph([
      ...events,
      ev("approval.resolved", { approvalId: "ap1", decision: "approved" }),
    ]);
    expect(resolved.nodes.find((n) => n.kind === "approval")?.status).toBe("resolved");
  });

  it("marks tool nodes completed/denied and adds artifacts", () => {
    const events = [
      ev("run.started", { agentName: "A", agentTier: "engineering" }),
      ev("plan.created", { steps: [{ id: "s1", name: "x", description: "", dependsOn: [] }] }),
      ev("tool.call", { stepId: "s1", toolCallId: "t1", name: "calculator", risk: "low" }),
      ev("tool.result", { stepId: "s1", toolCallId: "t1", name: "calculator", ok: true }),
      ev("artifact.created", { stepId: "s1", artifactId: "a1", name: "out.md", kind: "markdown" }),
    ];
    const g = buildRunGraph(events);
    expect(g.nodes.find((n) => n.id === "tool_t1")?.status).toBe("completed");
    expect(g.nodes.find((n) => n.kind === "artifact")?.label).toBe("out.md");
  });

  it("returns empty graph for no events", () => {
    expect(buildRunGraph([]).nodes).toHaveLength(0);
  });
});
