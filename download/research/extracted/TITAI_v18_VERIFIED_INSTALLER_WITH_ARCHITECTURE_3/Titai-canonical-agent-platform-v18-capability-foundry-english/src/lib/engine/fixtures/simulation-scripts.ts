import type { SimulationScript } from "../types";

/**
 * Deterministic scripts that drive keyless demo runs. Each script has a plan
 * and, per step, a sequence of "turns" (one per tool iteration). Turn 0 of a
 * step that uses a tool returns a toolCall; the next turn returns final text.
 */

const researchScript: SimulationScript = {
  id: "research",
  keywords: ["research", "compare", "investigate", "analyze", "evaluate", "recommend"],
  plan: [
    { name: "gather", description: "Gather relevant sources and context" },
    { name: "analyze", description: "Analyze findings", dependsOn: ["gather"] },
    { name: "recommend", description: "Write a recommendation", dependsOn: ["analyze"] },
  ],
  stepTurns: {
    gather: [
      {
        deltas: ["Let me pull in ", "current context ", "before analyzing.\n"],
        toolCalls: [
          {
            id: "call_time_1",
            name: "current_time",
            arguments: {},
          },
        ],
        finalText: "",
      },
      {
        deltas: ["I have the baseline. ", "Sources identified across ", "three approaches.\n"],
        finalText: "Gathered three candidate approaches with tradeoffs noted.",
      },
    ],
    analyze: [
      {
        deltas: ["Weighing each option ", "on cost, complexity, ", "and reliability.\n"],
        finalText:
          "Option B balances simplicity and reliability best; Option A is fastest but riskier.",
      },
    ],
    recommend: [
      {
        deltas: ["Drafting the ", "final recommendation ", "as an artifact.\n"],
        toolCalls: [
          {
            id: "call_artifact_1",
            name: "write_artifact",
            arguments: {
              name: "recommendation.md",
              kind: "markdown",
              content:
                "# Recommendation\n\n**Chosen approach: Option B.**\n\n- Balanced complexity and reliability\n- Lower operational risk than Option A\n- Clear migration path\n\n## Next steps\n1. Prototype Option B\n2. Load-test under expected traffic\n3. Ship behind a flag",
            },
          },
        ],
        finalText: "",
      },
      {
        deltas: ["Recommendation saved. ", "Summary complete.\n"],
        finalText:
          "Recommended Option B and saved a full write-up as recommendation.md.",
      },
    ],
  },
};

const buildScript: SimulationScript = {
  id: "build",
  keywords: ["build", "add", "implement", "create", "feature", "refactor", "fix", "deploy", "ship"],
  plan: [
    { name: "plan", description: "Draft an implementation plan" },
    { name: "implement", description: "Implement the change", dependsOn: ["plan"] },
    { name: "verify", description: "Verify the result", dependsOn: ["implement"] },
    { name: "deploy", description: "Deploy the change", dependsOn: ["verify"] },
  ],
  stepTurns: {
    plan: [
      {
        deltas: ["Breaking the work ", "into concrete steps.\n"],
        finalText: "Plan ready: implement, verify, then deploy behind a flag.",
      },
    ],
    implement: [
      {
        deltas: ["Writing the ", "implementation ", "and notes.\n"],
        toolCalls: [
          {
            id: "call_artifact_2",
            name: "write_artifact",
            arguments: {
              name: "changes.md",
              kind: "markdown",
              content:
                "# Implementation Notes\n\n- Added the requested capability\n- Wired it into the existing flow\n- Added guards for edge cases",
            },
          },
        ],
        finalText: "",
      },
      {
        deltas: ["Implementation ", "complete.\n"],
        finalText: "Implemented the change and documented it in changes.md.",
      },
    ],
    verify: [
      {
        deltas: ["Running a ", "quick check ", "of the numbers.\n"],
        toolCalls: [
          {
            id: "call_calc_1",
            name: "calculator",
            arguments: { expression: "42 * 3 + 7" },
          },
        ],
        finalText: "",
      },
      {
        deltas: ["Checks pass. ", "Ready to deploy.\n"],
        finalText: "Verification passed. The change behaves as expected.",
      },
    ],
    deploy: [
      {
        deltas: ["Requesting a ", "deploy — this ", "needs sign-off.\n"],
        toolCalls: [
          {
            id: "call_deploy_1",
            name: "simulate_deploy",
            arguments: { environment: "production", canaryPercent: 5 },
          },
        ],
        finalText: "",
      },
      {
        deltas: ["Deploy complete. ", "Canary healthy.\n"],
        finalText: "Deployed to production at 5% canary. All signals nominal.",
      },
    ],
  },
};

const genericScript: SimulationScript = {
  id: "generic",
  keywords: [],
  plan: [
    { name: "understand", description: "Understand the objective" },
    { name: "act", description: "Take action", dependsOn: ["understand"] },
    { name: "summarize", description: "Summarize the outcome", dependsOn: ["act"] },
  ],
  stepTurns: {
    understand: [
      {
        deltas: ["Reading the ", "objective carefully.\n"],
        finalText: "Understood the objective and its constraints.",
      },
    ],
    act: [
      {
        deltas: ["Producing a ", "concrete deliverable.\n"],
        toolCalls: [
          {
            id: "call_artifact_3",
            name: "write_artifact",
            arguments: {
              name: "output.md",
              kind: "markdown",
              content:
                "# Result\n\nHere is the completed work for your objective, with the key points captured and ready to review.",
            },
          },
        ],
        finalText: "",
      },
      {
        deltas: ["Deliverable ", "ready.\n"],
        finalText: "Produced the deliverable and saved it as output.md.",
      },
    ],
    summarize: [
      {
        deltas: ["Wrapping up ", "with a summary.\n"],
        finalText:
          "Completed the objective and saved the result. Ready for your review.",
      },
    ],
  },
};

export const SIMULATION_SCRIPTS: SimulationScript[] = [
  researchScript,
  buildScript,
  genericScript,
];

export function pickSimulationScript(objective: string): SimulationScript {
  const lower = objective.toLowerCase();
  let best: { script: SimulationScript; score: number } | null = null;
  for (const script of SIMULATION_SCRIPTS) {
    const score = script.keywords.reduce(
      (acc, kw) => acc + (lower.includes(kw) ? 1 : 0),
      0,
    );
    if (score > 0 && (!best || score > best.score)) {
      best = { script, score };
    }
  }
  return best?.script ?? genericScript;
}
