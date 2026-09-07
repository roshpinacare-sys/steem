/**
 * policy.ts — per-repo, user-authored agent policy (`.qodo/policy.yml`).
 *
 * Today the agent is configured almost entirely by operator-side global env
 * vars. This gives the *repo owner* a versioned, portable control surface that
 * travels with their code: a hard spend cap, an autonomy floor, and future
 * knobs — no vendor dashboard, no code changes.
 *
 * SOVEREIGNTY / SECURITY: the policy is read from the repository's **default
 * branch (trunk)**, never from the PR head. A pull request therefore cannot
 * raise its own budget cap or flip autonomy to `full` — the policy is whatever
 * the repo owner committed to main. Absent or malformed policy → safe
 * defaults that preserve today's behavior exactly (fail-open, but loudly).
 */
import { z } from "zod";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { GitHubClient } from "./github-client.js";
import { log } from "./logger.js";

/** Autonomy floor the repo owner is willing to grant the agent. */
export type Autonomy = "full" | "mentor" | "dry-run";

export const PolicySchema = z
  .object({
    /** Schema version; only 1 is understood today. */
    version: z.literal(1).default(1),
    budget: z
      .object({
        /** Hard cap on estimated LLM spend for a single run, in USD cents. */
        maxUsdCents: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    /**
     * Autonomy floor:
     *  - "full"    → normal operation (default).
     *  - "mentor"  → force mentor mode (human approves before Ghost Commit).
     *  - "dry-run" → never commit/deploy/merge; plan + gate + simulate only.
     */
    autonomy: z.enum(["full", "mentor", "dry-run"]).default("full"),
    /**
     * How the human-approval (mentor) gate is decided. Refines `autonomy:
     * full`; ignored when autonomy is `mentor` (which always requires
     * approval) or `dry-run` (which never commits). Omit to inherit the
     * operator's env / supervisor / uncertainty behavior unchanged.
     *  - "manual" → always require approval before the Ghost Commit.
     *  - "trust"  → require approval only when the run's trust-ledger bond is
     *               below the auto-merge threshold; auto-proceed when bonded.
     *  - "auto"   → never require the interactive gate (the owner pre-approves;
     *               gates, kill switch, budget and audit still apply).
     */
    approval: z.enum(["manual", "trust", "auto"]).optional(),
  })
  .strict();

export type QodoPolicy = z.infer<typeof PolicySchema>;

export const DEFAULT_POLICY: QodoPolicy = { version: 1, autonomy: "full" };

export interface LoadedPolicy {
  policy: QodoPolicy;
  /** Repo path the policy came from, or null when none was found. */
  source: string | null;
  /** Parse/validation error message when a file existed but was invalid. */
  error?: string;
  /** Raw policy file contents as fetched — receipt evidence. */
  rawText?: string | null;
  /** sha256 hex of rawText; lets a receipt prove WHICH policy governed. */
  sha256?: string | null;
}

function policyHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Candidate policy files, in priority order. */
const CANDIDATES = [".qodo/policy.yml", ".qodo/policy.yaml", ".qodo/policy.json"];

/**
 * Parse + validate a policy file's raw contents. Exported for tests.
 * YAML is a superset of JSON, so js-yaml parses both `.yml` and `.json`.
 */
export function parsePolicy(raw: string): QodoPolicy {
  const data = yaml.load(raw);
  if (data === null || data === undefined) return DEFAULT_POLICY;
  return PolicySchema.parse(data);
}

/**
 * Load the repo's policy from its trunk. `trunkRef` should be the default
 * branch ref (e.g. "heads/main"); reading from trunk — not the PR head — is
 * the security property that stops a PR from editing its own guardrails.
 */
export async function loadPolicy(gh: GitHubClient, trunkRef: string): Promise<LoadedPolicy> {
  for (const path of CANDIDATES) {
    let raw: string | null;
    try {
      raw = await gh.getFileAtRef(path, trunkRef);
    } catch {
      continue; // treat a fetch error as "not present at this path"
    }
    if (raw === null || raw.trim() === "") continue;
    try {
      const policy = parsePolicy(raw);
      log.info("policy loaded", { source: path, autonomy: policy.autonomy, maxUsdCents: policy.budget?.maxUsdCents });
      return { policy, source: path, rawText: raw, sha256: policyHash(raw) };
    } catch (e: unknown) {
      // Fail-open but LOUD: a malformed policy must never brick the agent, but
      // it must not silently drop a cap the owner intended either.
      const error = e instanceof Error ? e.message : String(e);
      log.warn("policy file is invalid — ignoring it and running with defaults", { source: path, error });
      return { policy: DEFAULT_POLICY, source: path, error, rawText: raw, sha256: policyHash(raw) };
    }
  }
  return { policy: DEFAULT_POLICY, source: null, rawText: null, sha256: null };
}

/**
 * Load the policy from the LOCAL working tree (`<dir>/.qodo/policy.*`). This is
 * the local-first path for the `--policy` inspector and offline/dry-run use:
 * the owner can validate and see the exact control surface in their checkout
 * with zero credentials. Production runs still read from the trunk via
 * `loadPolicy()` for the PR-can't-edit-its-own-guardrails property.
 */
export function loadPolicyFromDisk(dir: string = process.cwd()): LoadedPolicy {
  for (const rel of CANDIDATES) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, rel), "utf8");
    } catch {
      continue; // not present at this path
    }
    if (raw.trim() === "") continue;
    try {
      return { policy: parsePolicy(raw), source: rel };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      return { policy: DEFAULT_POLICY, source: rel, error };
    }
  }
  return { policy: DEFAULT_POLICY, source: null };
}

/**
 * Human-readable summary of the effective control surface — the "operationally
 * clear" view printed by `cli.js --policy`. Pure string builder, no I/O.
 */
export function describePolicy(loaded: LoadedPolicy): string {
  const { policy, source, error } = loaded;
  const lines: string[] = [];
  lines.push("Qodo repository control surface (.qodo/policy)");
  lines.push("──────────────────────────────────────────────");
  lines.push(`  source        : ${source ?? "(none — built-in defaults)"}`);
  if (error) lines.push(`  ⚠ invalid     : ${error}  → running with safe defaults`);

  const cap = policy.budget?.maxUsdCents;
  lines.push(
    `  budget cap    : ${cap ? `$${(cap / 100).toFixed(2)} per run (hard stop)` : "none (unbounded — only the operator cost alert applies)"}`,
  );

  const autonomyDesc: Record<string, string> = {
    full: "full — normal operation",
    mentor: "mentor — every change waits for human approval",
    "dry-run": "dry-run — plan/code/validate only; never commit, deploy or merge",
  };
  lines.push(`  autonomy      : ${autonomyDesc[policy.autonomy]}`);

  const approvalDesc: Record<string, string> = {
    manual: "manual — always require approval before the Ghost Commit",
    trust: "trust — auto-proceed when the trust bond is high; else require approval",
    auto: "auto — never require the interactive gate (owner pre-approves)",
  };
  const approvalLine = policy.autonomy === "mentor"
    ? "manual (forced by autonomy: mentor)"
    : policy.autonomy === "dry-run"
      ? "n/a (dry-run never commits)"
      : policy.approval
        ? approvalDesc[policy.approval]
        : "inherit — env / supervisor / uncertainty decide (unchanged)";
  lines.push(`  approval      : ${approvalLine}`);

  lines.push("");
  lines.push("  Always enforced (not policy-toggleable): 5-gate validator,");
  lines.push("  secret/path guards, sacred-file integrity, kill switch, audit log.");
  return lines.join("\n");
}
