import type { ToolDef } from "../types";

/**
 * A high-risk no-op whose only purpose is to exercise the human-approval gate
 * in demos and tests. It never touches anything real.
 */
export const simulateDeployTool: ToolDef = {
  name: "simulate_deploy",
  description:
    "Deploy the current change to an environment (simulated — no real side effects). High risk; typically requires approval.",
  risk: "high",
  schemaVersion: 1,
  effect: "write",
  idempotency: "receipt",
  network: false,
  filesystem: false,
  timeoutMs: 5000,
  maxOutputBytes: 10000,
  parameters: {
    type: "object",
    properties: {
      environment: {
        type: "string",
        description: "Target environment, e.g. 'production'.",
        minLength: 1,
        maxLength: 64,
        pattern: "^[A-Za-z0-9._-]+$",
      },
      canaryPercent: {
        type: "number",
        description: "Percentage of traffic for the canary.",
        minimum: 0,
        maximum: 100,
      },
    },
    required: ["environment"],
    additionalProperties: false,
  },
  async execute(args) {
    const environment = String(args.environment ?? "production");
    const canaryPercent = Number(args.canaryPercent ?? 100);
    return {
      ok: true,
      output: {
        environment,
        canaryPercent,
        deploymentId: `deploy_${Date.now().toString(36)}`,
        status: "healthy",
        simulated: true,
      },
    };
  },
};
