import { describe, expect, it } from "vitest";
import {
  parseRunnerMode,
  runnerModeUsesDurableExecution,
  runnerModeUsesShadow,
} from "@/lib/engine/runner-mode";

describe("runner mode cutover", () => {
  it("fails closed to legacy for unknown configuration", () => {
    expect(parseRunnerMode("surprise")).toBe("legacy");
    expect(parseRunnerMode(undefined)).toBe("legacy");
  });

  it("requires explicit opt in in durable_opt_in mode", () => {
    expect(runnerModeUsesDurableExecution("durable_opt_in", false)).toBe(false);
    expect(runnerModeUsesDurableExecution("durable_opt_in", true)).toBe(true);
  });

  it("separates shadow from execution cutover", () => {
    expect(runnerModeUsesShadow("durable_shadow")).toBe(true);
    expect(runnerModeUsesDurableExecution("durable_shadow", true)).toBe(false);
  });
});
