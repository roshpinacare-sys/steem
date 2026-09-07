import { describe, expect, it } from "vitest";
import { runBaselineEvaluation } from "@/lib/evaluation/baseline";

describe("baseline evaluation harness", () => {
  it("is deterministic and fully passing", () => {
    const first = runBaselineEvaluation();
    const second = runBaselineEvaluation();
    expect(second).toEqual(first);
    expect(first.deterministic).toBe(true);
    expect(first.totals.failed).toBe(0);
    expect(first.totals.passRate).toBe(100);
  });
});
