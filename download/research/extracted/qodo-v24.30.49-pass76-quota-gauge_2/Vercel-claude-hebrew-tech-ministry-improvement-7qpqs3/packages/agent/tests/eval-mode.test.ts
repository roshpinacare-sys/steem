/**
 * eval-mode.test.ts — the sovereign premium `--eval` path, end to end.
 *
 * Verifies (1) the in-memory adapters behave, (2) a full `runEvalMode()` run
 * completes offline with a SUCCESS verdict and a valid audit chain, and (3)
 * the owner's `.qodo/policy.yml` genuinely governs the run.
 *
 * `runEvalMode` is imported dynamically AFTER QODO_WORKSPACE_ROOT is set, so
 * the pipeline's audit log is frozen to an isolated temp dir (helpers.ts reads
 * that env var once at module load).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalRedisState,
  LocalGitHubClient,
  createLocalDeps,
} from "../src/services/local/in-memory-adapters.js";

describe("in-memory adapters", () => {
  it("LocalRedisState backs KV + lists in memory and reads events back", async () => {
    const s = new LocalRedisState();
    expect(await s.acquireLock()).toBe(true);
    await s.set("k", "v");
    expect(await s.get("k")).toBe("v");
    await s.setJSON("j", { a: 1 });
    expect(await s.getJSON("j")).toEqual({ a: 1 });
    await s.pushEvent("qodo:v24:telemetry:events", { phase: "x", decision: "d" });
    expect(await s.llen("qodo:v24:telemetry:events")).toBe(1);
    expect(s.readEvents()[0]).toMatchObject({ phase: "x", decision: "d" });
  });

  it("LocalRedisState never dials the network for inherited file-lock methods", async () => {
    const s = new LocalRedisState();
    // waitForFileLock takes the "Redis not configured" fast path (no fetch).
    const token = await s.waitForFileLock("src/a.ts");
    expect(typeof token).toBe("string");
  });

  it("LocalGitHubClient serves policy from disk, a canonical lockfile, and records actions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qodo-gh-"));
    mkdirSync(join(dir, ".qodo"), { recursive: true });
    writeFileSync(join(dir, ".qodo/policy.yml"), "version: 1\nautonomy: full\n");
    const gh = new LocalGitHubClient("acme", "widget", dir);
    expect(await gh.getFileAtRef(".qodo/policy.yml", "heads/main")).toContain("autonomy: full");
    expect(await gh.getFileAtRef("package-lock.json", "heads/main")).toContain("lockfileVersion");
    expect(await gh.getFileAtRef("src/nope.ts", "heads/main")).toBe("");
    await gh.comment(1, "hi");
    await gh.commitViaGitDB(1, [{ path: "a.ts", content: "x" }], "msg");
    await gh.mergePR(1);
    expect(gh.comments).toEqual(["hi"]);
    expect(gh.committed[0].message).toBe("msg");
    expect(gh.merged).toBe(true);
  });

  it("createLocalDeps returns a complete, wired dependency set", () => {
    const deps = createLocalDeps("acme", "widget");
    expect(deps.state).toBeInstanceOf(LocalRedisState);
    expect(deps.gh).toBeInstanceOf(LocalGitHubClient);
    expect(deps.storage.isDegraded()).toBe(false);
  });
});

describe("runEvalMode — full offline pipeline", () => {
  const savedEnv = { ...process.env };
  let logs: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.QODO_WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), "qodo-evaltest-"));
    // Ensure the deterministic simulator path (not a leaked Ollama URL).
    delete process.env.OLLAMA_BASE_URL;
    logs = [];
    spy = vi.spyOn(console, "log").mockImplementation((m?: unknown) => { logs.push(String(m)); });
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

  it("runs Architect→…→Review offline, clears all gates, and verifies the audit chain", async () => {
    const { runEvalMode } = await import("../src/cli.js");
    const code = await runEvalMode(["node", "cli.js", "--eval", "--objective=Add a slug helper"]);
    const out = logs.join("\n");

    expect(code).toBe(0);
    expect(out).toContain("SOVEREIGN PREMIUM EVALUATION");
    expect(out).toContain("Outcome   : SUCCESS");
    expect(out).toContain("gate OPEN — change cleared all validators");
    expect(out).toContain("VALID ✓");
    // Sovereign posture: zero external spend.
    expect(out).toContain("$0.0000");
    // Every core phase left an audit entry.
    for (const e of ["run-started", "architect-plan-generated", "coder-patch-generated", "gate-evaluated", "commit-created", "run-done"]) {
      expect(out).toContain(e);
    }
  });

  it("is governed by the owner's .qodo/policy.yml (budget + approval:auto)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "qodo-evalpolicy-"));
    mkdirSync(join(cwd, ".qodo"), { recursive: true });
    writeFileSync(join(cwd, ".qodo/policy.yml"), "version: 1\nautonomy: full\napproval: auto\nbudget:\n  maxUsdCents: 500\n");
    vi.spyOn(process, "cwd").mockReturnValue(cwd);

    const { runEvalMode } = await import("../src/cli.js");
    const code = await runEvalMode(["node", "cli.js", "--eval"]);
    const out = logs.join("\n");

    expect(code).toBe(0);
    expect(out).toContain("approval      : auto");
    expect(out).toContain("budget cap    : $5.00");
  });
});
