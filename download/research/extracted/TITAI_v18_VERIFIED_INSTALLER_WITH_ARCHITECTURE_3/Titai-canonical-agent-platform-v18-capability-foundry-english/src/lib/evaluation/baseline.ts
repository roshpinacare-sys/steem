import {
  assertRunTransition,
  assertStepTransition,
} from "@/lib/canonical/lifecycle";
import { buildRunGraph } from "@/components/canvas/build-graph";
import { summarizeRunEvidence } from "@/lib/engine/evidence-summary";
import type { ClientRunEvent } from "@/lib/engine/event-types";
import { DEFAULT_POLICY, evaluatePolicies } from "@/lib/engine/policy";

export interface EvaluationCaseResult {
  id: string;
  title: string;
  criterion: string;
  passed: boolean;
  observed: unknown;
  expected: unknown;
}

export interface BaselineEvaluationResult {
  schemaVersion: 1;
  suite: "titai-baseline";
  deterministic: true;
  totals: {
    cases: number;
    passed: number;
    failed: number;
    passRate: number;
  };
  cases: EvaluationCaseResult[];
}

export function runBaselineEvaluation(): BaselineEvaluationResult {
  const completeEvents = createCompleteRunFixture();
  const incompleteEvents = createIncompleteRunFixture();
  const cases: EvaluationCaseResult[] = [];

  cases.push(
    evaluateCase(
      "LIF-001",
      "Legal run lifecycle",
      "queued -> running -> awaiting_approval -> running -> completed is accepted",
      () => {
        assertRunTransition("queued", "running");
        assertRunTransition("running", "awaiting_approval");
        assertRunTransition("awaiting_approval", "running");
        assertRunTransition("running", "completed");
        return true;
      },
      true,
    ),
  );

  cases.push(
    evaluateCase(
      "LIF-002",
      "Illegal run lifecycle",
      "queued -> completed is rejected",
      () => {
        try {
          assertRunTransition("queued", "completed");
          return false;
        } catch {
          return true;
        }
      },
      true,
    ),
  );

  cases.push(
    evaluateCase(
      "LIF-003",
      "Illegal step reopening",
      "completed -> running is rejected",
      () => {
        try {
          assertStepTransition("completed", "running");
          return false;
        } catch {
          return true;
        }
      },
      true,
    ),
  );

  const completeEvidence = summarizeRunEvidence(completeEvents);
  cases.push(
    evaluateCase(
      "EVD-001",
      "Complete evidence reconstruction",
      "A complete deterministic run has no gaps and is reconstructable",
      () => ({
        state: completeEvidence.state,
        reconstructable: completeEvidence.reconstructable,
        gaps: completeEvidence.gaps.length,
      }),
      { state: "evidence_complete", reconstructable: true, gaps: 0 },
    ),
  );

  const incompleteEvidence = summarizeRunEvidence(incompleteEvents);
  cases.push(
    evaluateCase(
      "EVD-002",
      "Missing tool-result detection",
      "A completed run with an unresolved tool call is rejected as complete evidence",
      () => incompleteEvidence.gaps.map((gap) => gap.code),
      ["unresolved-tool-call", "completed-run-with-incomplete-step"],
    ),
  );

  const graph = buildRunGraph(completeEvents);
  cases.push(
    evaluateCase(
      "GRAPH-001",
      "Event-to-graph projection",
      "The run graph contains the agent, one step, one tool, and one artifact",
      () => graph.nodes.map((node) => node.kind).sort(),
      ["agent", "artifact", "step", "tool"],
    ),
  );

  const highRiskDecision = evaluatePolicies(
    [
      {
        id: "default",
        enabled: true,
        priority: DEFAULT_POLICY.priority,
        name: DEFAULT_POLICY.name,
        rules: DEFAULT_POLICY.rules,
      },
    ],
    {
      toolName: "simulate_deploy",
      risk: "high",
      agentTier: "engineering",
      arguments: {},
    },
  );
  cases.push(
    evaluateCase(
      "POL-001",
      "Fail-closed high-risk policy",
      "A high-risk deployment tool requires human approval",
      () => highRiskDecision.effect,
      "human",
    ),
  );

  const lowRiskDecision = evaluatePolicies([], {
    toolName: "calculator",
    risk: "low",
    agentTier: "engineering",
    arguments: { expression: "2+2" },
  });
  cases.push(
    evaluateCase(
      "POL-002",
      "Low-risk default policy",
      "A low-risk tool remains locally executable without a provider key",
      () => lowRiskDecision.effect,
      "auto",
    ),
  );

  const passed = cases.filter((result) => result.passed).length;
  return {
    schemaVersion: 1,
    suite: "titai-baseline",
    deterministic: true,
    totals: {
      cases: cases.length,
      passed,
      failed: cases.length - passed,
      passRate: Math.round((passed / cases.length) * 100),
    },
    cases,
  };
}

function evaluateCase(
  id: string,
  title: string,
  criterion: string,
  execute: () => unknown,
  expected: unknown,
): EvaluationCaseResult {
  let observed: unknown;
  try {
    observed = execute();
  } catch (error) {
    observed = {
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    id,
    title,
    criterion,
    passed: stableStringify(observed) === stableStringify(expected),
    observed,
    expected,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

function createCompleteRunFixture(): ClientRunEvent[] {
  return [
    event(1, "run.started", { agentName: "Verifier", provider: "simulation" }),
    event(2, "plan.created", {
      steps: [
        { id: "step-1", name: "inspect", description: "Inspect", dependsOn: [] },
      ],
    }),
    event(3, "step.started", { stepId: "step-1", name: "inspect" }),
    event(4, "tool.call", {
      stepId: "step-1",
      toolCallId: "tool-1",
      name: "calculator",
      risk: "low",
    }),
    event(5, "tool.result", {
      stepId: "step-1",
      toolCallId: "tool-1",
      name: "calculator",
      ok: true,
      result: 4,
    }),
    event(6, "artifact.created", {
      stepId: "step-1",
      artifactId: "artifact-1",
      name: "result.md",
      kind: "markdown",
    }),
    event(7, "step.completed", { stepId: "step-1" }),
    event(8, "run.completed", { tokenUsage: { input: 10, output: 4 } }),
  ];
}

function createIncompleteRunFixture(): ClientRunEvent[] {
  return [
    event(1, "run.started"),
    event(2, "plan.created", {
      steps: [
        { id: "step-1", name: "deploy", description: "Deploy", dependsOn: [] },
      ],
    }),
    event(3, "tool.call", {
      stepId: "step-1",
      toolCallId: "tool-1",
      name: "simulate_deploy",
      risk: "high",
    }),
    event(4, "run.completed"),
  ];
}

function event(
  id: number,
  type: ClientRunEvent["type"],
  payload: unknown = {},
): ClientRunEvent {
  return { id, seq: id - 1, type, payload };
}
