import { describe, expect, it } from "vitest";
import {
  InvalidExecutionPlanError,
  validateExecutionPlan,
} from "@/lib/engine/plan";

const valid = {
  steps: [
    { name: "inspect", description: "Inspect", dependsOn: [] },
    { name: "build", description: "Build", dependsOn: ["inspect"] },
  ],
};

describe("validateExecutionPlan", () => {
  it("accepts a bounded acyclic plan", () => {
    expect(validateExecutionPlan(valid, 4).steps).toHaveLength(2);
  });

  it("rejects duplicate step names", () => {
    expect(() =>
      validateExecutionPlan(
        { steps: [{ name: "x" }, { name: "x" }] },
        4,
      ),
    ).toThrow(InvalidExecutionPlanError);
  });

  it("rejects unknown and self dependencies", () => {
    expect(() =>
      validateExecutionPlan(
        { steps: [{ name: "x", dependsOn: ["missing"] }] },
        4,
      ),
    ).toThrow(/unknown step/i);
    expect(() =>
      validateExecutionPlan(
        { steps: [{ name: "x", dependsOn: ["x"] }] },
        4,
      ),
    ).toThrow(/itself/i);
  });

  it("rejects dependency cycles", () => {
    expect(() =>
      validateExecutionPlan(
        {
          steps: [
            { name: "a", dependsOn: ["b"] },
            { name: "b", dependsOn: ["a"] },
          ],
        },
        4,
      ),
    ).toThrow(/cycle/i);
  });

  it("enforces the configured step budget", () => {
    expect(() => validateExecutionPlan(valid, 1)).toThrow(/maximum/i);
  });
});
