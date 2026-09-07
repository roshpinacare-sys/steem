/**
 * rehearsal.test.ts — the $0 pre-flight. Determinism is the load-bearing
 * property: two rehearsals of the same objective must distill byte-identical
 * envelopes (same sha256), or the receipt binding would be meaningless.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("runRehearsal", () => {
  const savedEnv = { ...process.env };
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.QODO_WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), "qodo-rehearsal-"));
    delete process.env.OLLAMA_BASE_URL;
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    spy.mockRestore();
    process.env = { ...savedEnv };
    const { _resetEnvCache } = await import("../src/services/env-validator.js");
    const { _resetBudget } = await import("../src/services/budget-governor.js");
    _resetEnvCache();
    _resetBudget();
    vi.restoreAllMocks();
  });

  it("walks the real pipeline offline and distills a stable, timestamp-free envelope", async () => {
    const { runRehearsal } = await import("../src/services/rehearsal.js");

    const first = await runRehearsal("acme", "widget", "Add a slug helper");
    expect(first.llmPath).toBe("simulation");
    expect(first.gateOpen).toBe(true);
    expect(first.phasesWalked).toEqual(expect.arrayContaining(["start", "architect", "coder", "gate", "commit", "done"]));
    expect(first.filesPredicted.length).toBeGreaterThan(0);
    expect(first.envelopeSha256).toMatch(/^[0-9a-f]{64}$/);

    // Determinism: an identical rehearsal hashes identically.
    const { _resetEnvCache } = await import("../src/services/env-validator.js");
    const { _resetBudget } = await import("../src/services/budget-governor.js");
    _resetEnvCache();
    _resetBudget();
    const second = await runRehearsal("acme", "widget", "Add a slug helper");
    expect(second.envelopeSha256).toBe(first.envelopeSha256);
    expect(second.filesPredicted).toEqual(first.filesPredicted);
  }, 90_000);

  it("restores every env var it touched and resets the cost tracker", async () => {
    const { runRehearsal } = await import("../src/services/rehearsal.js");
    const { costTracker } = await import("../src/services/ai-router.js");

    process.env.OBJECTIVE = "operator objective";
    delete process.env.QODO_LLM_SIM;
    await runRehearsal("acme", "widget", "Add a slug helper");

    expect(process.env.OBJECTIVE).toBe("operator objective");
    expect(process.env.QODO_LLM_SIM).toBeUndefined();
    expect(costTracker.totals().callCount).toBe(0);
  }, 90_000);
});
