import type { ClientRunEvent } from "@/lib/engine/event-types";
import type { AgentTier, RiskLevel } from "@/lib/db/schema";

/**
 * Pure reducer: run events → a node/edge graph for the Living Canvas.
 * No React Flow imports here so it stays unit-testable.
 */

export type NodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "denied"
  | "awaiting"
  | "resolved";

export type TitaiNodeKind = "agent" | "step" | "tool" | "approval" | "artifact";

export interface TitaiNode {
  id: string;
  kind: TitaiNodeKind;
  label: string;
  sublabel?: string;
  status: NodeStatus;
  tier?: AgentTier;
  risk?: RiskLevel;
  approvalId?: string;
  parentStepId?: string;
}

export interface TitaiEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
}

export interface RunGraph {
  nodes: TitaiNode[];
  edges: TitaiEdge[];
}

const AGENT_ID = "agent";

export function buildRunGraph(events: ClientRunEvent[]): RunGraph {
  const nodes = new Map<string, TitaiNode>();
  const edges = new Map<string, TitaiEdge>();
  const stepNameToId = new Map<string, string>();
  const toolCallToNode = new Map<string, string>();

  const addEdge = (source: string, target: string, animated = false) => {
    const id = `${source}->${target}`;
    edges.set(id, { id, source, target, animated });
  };

  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case "run.started":
        nodes.set(AGENT_ID, {
          id: AGENT_ID,
          kind: "agent",
          label: String(p.agentName ?? "Agent"),
          sublabel: String(p.provider ?? ""),
          status: "running",
          tier: (p.agentTier as AgentTier) ?? "engineering",
        });
        break;
      case "plan.created": {
        const steps = (p.steps as Array<{
          id: string;
          name: string;
          description: string;
          dependsOn: string[];
        }>) ?? [];
        for (const s of steps) {
          stepNameToId.set(s.name, s.id);
          nodes.set(s.id, {
            id: s.id,
            kind: "step",
            label: s.name,
            sublabel: s.description,
            status: "pending",
          });
        }
        // Wire edges: agent → roots, and dependency edges.
        for (const s of steps) {
          if (!s.dependsOn || s.dependsOn.length === 0) {
            addEdge(AGENT_ID, s.id);
          } else {
            for (const dep of s.dependsOn) {
              const depId = stepNameToId.get(dep);
              if (depId) addEdge(depId, s.id);
            }
          }
        }
        break;
      }
      case "step.started":
        setStatus(nodes, String(p.stepId), "running");
        break;
      case "step.completed":
        setStatus(nodes, String(p.stepId), "completed");
        break;
      case "step.failed":
        setStatus(nodes, String(p.stepId), "failed");
        break;
      case "tool.call": {
        const stepId = String(p.stepId);
        const nodeId = `tool_${p.toolCallId}`;
        toolCallToNode.set(String(p.toolCallId), nodeId);
        nodes.set(nodeId, {
          id: nodeId,
          kind: "tool",
          label: String(p.name),
          status: "running",
          risk: (p.risk as RiskLevel) ?? "low",
          parentStepId: stepId,
        });
        addEdge(stepId, nodeId, true);
        break;
      }
      case "tool.result": {
        const nodeId = toolCallToNode.get(String(p.toolCallId));
        if (nodeId) {
          setStatus(nodes, nodeId, p.denied ? "denied" : p.ok === false ? "failed" : "completed");
          const edge = edges.get(`${nodes.get(nodeId)?.parentStepId}->${nodeId}`);
          if (edge) edge.animated = false;
        }
        break;
      }
      case "approval.requested": {
        const stepId = String(p.stepId);
        const nodeId = `approval_${p.approvalId}`;
        nodes.set(nodeId, {
          id: nodeId,
          kind: "approval",
          label: "Approval",
          sublabel: String(p.toolName),
          status: "awaiting",
          risk: (p.risk as RiskLevel) ?? "high",
          approvalId: String(p.approvalId),
          parentStepId: stepId,
        });
        addEdge(stepId, nodeId, true);
        break;
      }
      case "approval.resolved": {
        // Find the approval node and mark resolved.
        for (const node of nodes.values()) {
          if (node.kind === "approval" && node.status === "awaiting") {
            node.status = p.decision === "approved" ? "resolved" : "denied";
            const edge = edges.get(`${node.parentStepId}->${node.id}`);
            if (edge) edge.animated = false;
          }
        }
        break;
      }
      case "artifact.created": {
        const stepId = String(p.stepId);
        const nodeId = `artifact_${p.artifactId}`;
        nodes.set(nodeId, {
          id: nodeId,
          kind: "artifact",
          label: String(p.name),
          sublabel: String(p.kind),
          status: "completed",
          parentStepId: stepId,
        });
        if (nodes.has(stepId)) addEdge(stepId, nodeId);
        break;
      }
      case "run.completed":
        setStatus(nodes, AGENT_ID, "completed");
        break;
      case "run.failed":
      case "run.cancelled":
        setStatus(nodes, AGENT_ID, "failed");
        break;
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function setStatus(nodes: Map<string, TitaiNode>, id: string, status: NodeStatus) {
  const node = nodes.get(id);
  if (node) node.status = status;
}
