/**
 * policy.test.ts — the per-repo policy layer (.qodo/policy.yml): schema
 * parsing, trunk loading (fail-open + security), and the hard budget governor.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parsePolicy,
  loadPolicy,
  loadPolicyFromDisk,
  describePolicy,
  DEFAULT_POLICY,
  PolicySchema,
} from "../src/services/policy.js";
import { initBudget, budgetStatus, _resetBudget } from "../src/services/budget-governor.js";
import { costTracker } from "../src/services/ai-router.js";
import type { GitHubClient } from "../src/services/github-client.js";

// A GitHubClient stand-in that serves canned file contents per path.
function fakeGh(files: Record<string, string | null>): GitHubClient {
  return {
    async getFileAtRef(path: string): Promise<string | null> {
      return path in files ? files[path] : null;
    },
  } as unknown as GitHubClient;
}

describe("policy schema + parsing", () => {
  it("parses a full YAML policy", () => {
    const p = parsePolicy("version: 1\nbudget:\n  maxUsdCents: 250\nautonomy: mentor\n");
    expect(p.version).toBe(1);
    expect(p.budget?.maxUsdCents).toBe(250);
    expect(p.autonomy).toBe("mentor");
  });

  it("parses JSON too (YAML is a JSON superset)", () => {
    const p = parsePolicy('{ "version": 1, "autonomy": "dry-run" }');
    expect(p.autonomy).toBe("dry-run");
  });

  it("defaults autonomy to full and leaves budget unset when omitted", () => {
    const p = parsePolicy("version: 1\n");
    expect(p.autonomy).toBe("full");
    expect(p.budget).toBeUndefined();
  });

  it("treats an empty document as the default policy", () => {
    expect(parsePolicy("")).toEqual(DEFAULT_POLICY);
  });

  it("rejects unknown top-level keys (strict schema)", () => {
    expect(() => parsePolicy("version: 1\nnope: true\n")).toThrow();
  });

  it("rejects an invalid autonomy value", () => {
    expect(() => parsePolicy("version: 1\nautonomy: yolo\n")).toThrow();
  });

  it("rejects a non-positive budget cap", () => {
    expect(() => PolicySchema.parse({ version: 1, budget: { maxUsdCents: 0 } })).toThrow();
    expect(() => PolicySchema.parse({ version: 1, budget: { maxUsdCents: -5 } })).toThrow();
  });
});

describe("policy loading (trunk, fail-open)", () => {
  it("loads the first present candidate file", async () => {
    const gh = fakeGh({ ".qodo/policy.yml": "version: 1\nbudget:\n  maxUsdCents: 500\n" });
    const loaded = await loadPolicy(gh, "heads/main");
    expect(loaded.source).toBe(".qodo/policy.yml");
    expect(loaded.policy.budget?.maxUsdCents).toBe(500);
    expect(loaded.error).toBeUndefined();
  });

  it("falls back to .json when no yaml is present", async () => {
    const gh = fakeGh({ ".qodo/policy.json": '{ "version": 1, "autonomy": "mentor" }' });
    const loaded = await loadPolicy(gh, "heads/main");
    expect(loaded.source).toBe(".qodo/policy.json");
    expect(loaded.policy.autonomy).toBe("mentor");
  });

  it("returns the default policy with a null source when no file exists", async () => {
    const loaded = await loadPolicy(fakeGh({}), "heads/main");
    expect(loaded.source).toBeNull();
    expect(loaded.policy).toEqual(DEFAULT_POLICY);
  });

  it("fails open (defaults) but records the error when the file is malformed", async () => {
    const gh = fakeGh({ ".qodo/policy.yml": "version: 1\nautonomy: nonsense\n" });
    const loaded = await loadPolicy(gh, "heads/main");
    expect(loaded.policy).toEqual(DEFAULT_POLICY); // never bricks the agent
    expect(loaded.source).toBe(".qodo/policy.yml");
    expect(loaded.error).toBeTruthy(); // …but the mistake is surfaced, not silent
  });
});

describe("approval control", () => {
  it("parses each approval mode", () => {
    expect(parsePolicy("version: 1\napproval: manual\n").approval).toBe("manual");
    expect(parsePolicy("version: 1\napproval: trust\n").approval).toBe("trust");
    expect(parsePolicy("version: 1\napproval: auto\n").approval).toBe("auto");
  });

  it("leaves approval unset by default (inherit current behavior)", () => {
    expect(parsePolicy("version: 1\n").approval).toBeUndefined();
  });

  it("rejects an unknown approval mode", () => {
    expect(() => parsePolicy("version: 1\napproval: whenever\n")).toThrow();
  });

  it("accepts the admin-owner max-capability shape", () => {
    const p = parsePolicy("version: 1\nautonomy: full\napproval: auto\n");
    expect(p.autonomy).toBe("full");
    expect(p.approval).toBe("auto");
    expect(p.budget).toBeUndefined(); // unbounded — owner's explicit choice
  });
});

describe("local-first disk loading", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qodo-policy-"));
    mkdirSync(join(dir, ".qodo"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("loads .qodo/policy.yml from the working tree", () => {
    writeFileSync(join(dir, ".qodo/policy.yml"), "version: 1\nautonomy: mentor\n");
    const loaded = loadPolicyFromDisk(dir);
    expect(loaded.source).toBe(".qodo/policy.yml");
    expect(loaded.policy.autonomy).toBe("mentor");
  });

  it("returns defaults with a null source when no policy file is present", () => {
    const loaded = loadPolicyFromDisk(dir);
    expect(loaded.source).toBeNull();
    expect(loaded.policy).toEqual(DEFAULT_POLICY);
  });

  it("fails open with an error on a malformed local file", () => {
    writeFileSync(join(dir, ".qodo/policy.json"), '{ "version": 1, "autonomy": "root" }');
    const loaded = loadPolicyFromDisk(dir);
    expect(loaded.policy).toEqual(DEFAULT_POLICY);
    expect(loaded.error).toBeTruthy();
  });
});

describe("describePolicy (operational summary)", () => {
  it("summarizes budget, autonomy and approval in plain text", () => {
    const out = describePolicy({
      policy: parsePolicy("version: 1\nbudget:\n  maxUsdCents: 500\nautonomy: full\napproval: auto\n"),
      source: ".qodo/policy.yml",
    });
    expect(out).toContain("$5.00 per run");
    expect(out).toContain("auto — never require the interactive gate");
    expect(out).toContain("Always enforced");
  });

  it("shows approval as forced when autonomy is mentor", () => {
    const out = describePolicy({ policy: parsePolicy("version: 1\nautonomy: mentor\n"), source: null });
    expect(out).toContain("manual (forced by autonomy: mentor)");
  });
});

describe("budget governor (hard cap over the live cost tracker)", () => {
  beforeEach(() => {
    _resetBudget();
    costTracker.reset();
  });

  it("is disabled when no cap is set (no behavior change)", () => {
    initBudget(undefined);
    costTracker.record("groq", "llama-3.3-70b", "T2", { prompt_tokens: 5_000_000, completion_tokens: 5_000_000 });
    expect(budgetStatus().exceeded).toBe(false);
    initBudget(0);
    expect(budgetStatus().exceeded).toBe(false);
  });

  it("does not trip while spend is under the cap", () => {
    initBudget(1_000_000); // $10,000 cap
    costTracker.record("groq", "llama-3.3-70b", "T2", { prompt_tokens: 1000, completion_tokens: 1000 });
    const b = budgetStatus();
    expect(b.exceeded).toBe(false);
    expect(b.spentCents).toBeGreaterThan(0);
  });

  it("trips once estimated spend reaches the cap", () => {
    initBudget(50); // 50-cent cap
    // A large token burn guarantees spend exceeds 50 cents regardless of the
    // exact per-token price (estimateCents always returns a positive value).
    costTracker.record("groq", "llama-3.3-70b", "T2", { prompt_tokens: 20_000_000, completion_tokens: 20_000_000 });
    const b = budgetStatus();
    expect(b.spentCents).toBeGreaterThanOrEqual(b.capCents);
    expect(b.exceeded).toBe(true);
  });
});
