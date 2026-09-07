import { describe, expect, it } from "vitest";
import { executeBoundedTool } from "@/lib/engine/tool-runtime";
import type { ToolDef } from "@/lib/engine/types";

function tool(overrides: Partial<ToolDef> = {}): ToolDef {
  return {
    name: "probe",
    description: "test tool",
    schemaVersion: 1,
    parameters: { type: "object" },
    risk: "low",
    effect: "read",
    idempotency: "intrinsic",
    network: false,
    filesystem: false,
    timeoutMs: 25,
    maxOutputBytes: 64,
    execute: async () => ({ ok: true, output: "ok" }),
    ...overrides,
  };
}

const context = {
  runId: "r1",
  stepId: "s1",
  dryRun: false,
  idempotencyKey: "k1",
  writeArtifact: () => "a1",
};

describe("bounded tool runtime", () => {
  it("returns a successful bounded result", async () => {
    const output = await executeBoundedTool(tool(), {}, context, new AbortController().signal);
    expect(output.result.ok).toBe(true);
    expect(output.outputBytes).toBeGreaterThan(0);
  });

  it("fails closed when output exceeds the declared byte budget", async () => {
    const output = await executeBoundedTool(
      tool({ maxOutputBytes: 8, execute: async () => ({ ok: true, output: "x".repeat(100) }) }),
      {},
      context,
      new AbortController().signal,
    );
    expect(output.result.ok).toBe(false);
    expect(output.result.error).toContain("tool_output_limit_exceeded");
  });

  it("times out a tool that ignores completion", async () => {
    const output = await executeBoundedTool(
      tool({ timeoutMs: 5, execute: async (_args, ctx) => new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true })) }),
      {},
      context,
      new AbortController().signal,
    );
    expect(output.timedOut).toBe(true);
    expect(output.result.error).toBe("tool_timeout:5");
  });

  it("distinguishes caller cancellation from timeout", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const output = await executeBoundedTool(
      tool({ timeoutMs: 100, execute: async (_args, ctx) => { if (ctx.signal.aborted) throw ctx.signal.reason; return { ok: true, output: "unexpected" }; } }),
      {},
      context,
      controller.signal,
    );
    expect(output.timedOut).toBe(false);
    expect(output.result.error).toContain("cancelled");
  });
});
