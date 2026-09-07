/**
 * doctor.test.ts — the owner readiness report (`cli.js --doctor`). Pure and
 * offline: injects a fake env + temp working dir, asserts the verdict, the
 * actionable output, and the policy/next-run preview.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/services/doctor.js";

const FULL_ENV: NodeJS.ProcessEnv = {
  GITHUB_TOKEN: "ghp_xxxxxxxxxx",
  GROQ_API_KEY: "gsk_xxxxxxxxxx",
  UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "xxxxxxxxxx",
};

describe("doctor readiness", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qodo-doctor-"));
    mkdirSync(join(dir, ".qodo"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is READY when all required config is present and policy is valid/absent", () => {
    const r = runDoctor(FULL_ENV, dir);
    expect(r.ready).toBe(true);
    expect(r.text).toContain("Verdict: READY");
    expect(r.text).toContain("Next run will");
  });

  it("is NOT READY and names the missing provider key", () => {
    const { GROQ_API_KEY, ...noProvider } = FULL_ENV; // eslint-disable-line @typescript-eslint/no-unused-vars
    const r = runDoctor(noProvider, dir);
    expect(r.ready).toBe(false);
    expect(r.text).toContain("NOT READY");
    expect(r.text).toContain("LLM provider key");
    // Actionable hint is surfaced for the failing required check.
    expect(r.text).toContain("Set one of GROQ_API_KEY");
  });

  it("accepts any single provider key (not just Groq)", () => {
    const { GROQ_API_KEY, ...base } = FULL_ENV; // eslint-disable-line @typescript-eslint/no-unused-vars
    const r = runDoctor({ ...base, OPENROUTER_API_KEY: "sk-or-xxxx" }, dir);
    expect(r.ready).toBe(true);
  });

  it("is NOT READY when the committed policy is invalid, and says so", () => {
    writeFileSync(join(dir, ".qodo/policy.yml"), "version: 1\nautonomy: root\n");
    const r = runDoctor(FULL_ENV, dir);
    expect(r.ready).toBe(false);
    expect(r.policyValid).toBe(false);
    expect(r.text).toContain(".qodo/policy is invalid");
  });

  it("previews the approval path from the policy (auto → no gate)", () => {
    writeFileSync(join(dir, ".qodo/policy.yml"), "version: 1\nautonomy: full\napproval: auto\nbudget:\n  maxUsdCents: 500\n");
    const r = runDoctor(FULL_ENV, dir);
    expect(r.ready).toBe(true);
    expect(r.text).toContain("no approval gate");
    expect(r.text).toContain("halt at $5.00");
  });

  it("suggests creating a policy when none is present", () => {
    const r = runDoctor(FULL_ENV, dir);
    expect(r.text).toContain(".qodo/policy.example.yml");
  });

  it("never prints secret values, only presence", () => {
    const r = runDoctor(FULL_ENV, dir);
    expect(r.text).not.toContain("ghp_xxxxxxxxxx");
    expect(r.text).not.toContain("gsk_xxxxxxxxxx");
  });
});
