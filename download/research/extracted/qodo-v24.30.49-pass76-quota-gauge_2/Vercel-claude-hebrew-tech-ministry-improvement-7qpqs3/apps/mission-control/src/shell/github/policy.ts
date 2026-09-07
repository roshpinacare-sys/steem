/**
 * policy.ts — read the repo's agent policy (.qodo/policy.yml) for the
 * Governance page. Parses the four known fields with a tiny hand parser —
 * the file is a flat, documented shape, so no YAML dependency is warranted.
 * Anything unrecognized degrades to "unrecognized", never a crash.
 */
import { ghGetFile, ghPutFile } from "./client.js";
import { decodeBase64Utf8, encodeUtf8Base64 } from "./encoding.js";
import type { GitHubConfig } from "./config.js";

export interface ParsedPolicy {
  version: number | null;
  budgetMaxUsdCents: number | null;
  autonomy: "full" | "mentor" | "dry-run" | "unrecognized" | null;
  approval: "manual" | "trust" | "auto" | "unrecognized" | null;
}

export interface PolicyFetchResult {
  found: boolean;
  path: string | null;
  raw: string | null;
  policy: ParsedPolicy | null;
}

const CANDIDATES = [".qodo/policy.yml", ".qodo/policy.yaml", ".qodo/policy.json"];

export async function fetchRepoPolicy(cfg: GitHubConfig): Promise<PolicyFetchResult> {
  for (const path of CANDIDATES) {
    try {
      const f = await ghGetFile(cfg, path);
      const raw = decodeBase64Utf8(f.content);
      return { found: true, path, raw, policy: path.endsWith(".json") ? parseJsonPolicy(raw) : parseYamlPolicy(raw) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("404")) throw e; // real error (auth, rate limit) — surface it
    }
  }
  return { found: false, path: null, raw: null, policy: null };
}

export function parseYamlPolicy(text: string): ParsedPolicy {
  const out: ParsedPolicy = { version: null, budgetMaxUsdCents: null, autonomy: null, approval: null };
  let inBudget = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const indented = /^\s/.test(line);
    const m = line.trim().match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, valueRaw] = m;
    const value = valueRaw.trim().replace(/^["']|["']$/g, "");
    if (!indented) {
      inBudget = key === "budget" && value === "";
      if (key === "version") out.version = Number.isFinite(Number(value)) ? Number(value) : null;
      if (key === "autonomy") out.autonomy = (["full", "mentor", "dry-run"] as const).find((v) => v === value) ?? "unrecognized";
      if (key === "approval") out.approval = (["manual", "trust", "auto"] as const).find((v) => v === value) ?? "unrecognized";
    } else if (inBudget && key === "maxUsdCents") {
      const n = Number(value);
      out.budgetMaxUsdCents = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
  }
  return out;
}

function parseJsonPolicy(text: string): ParsedPolicy {
  try {
    const d = JSON.parse(text) as Record<string, unknown>;
    const budget = d.budget as { maxUsdCents?: unknown } | undefined;
    const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | "unrecognized" | null =>
      v == null ? null : (allowed.find((a) => a === v) ?? "unrecognized");
    return {
      version: typeof d.version === "number" ? d.version : null,
      budgetMaxUsdCents: typeof budget?.maxUsdCents === "number" ? budget.maxUsdCents : null,
      autonomy: pick(d.autonomy, ["full", "mentor", "dry-run"] as const),
      approval: pick(d.approval, ["manual", "trust", "auto"] as const),
    };
  } catch {
    return { version: null, budgetMaxUsdCents: null, autonomy: "unrecognized", approval: "unrecognized" };
  }
}

/** The example policy, installable as a real commit from Governance. */
export const EXAMPLE_POLICY = `# .qodo/policy.yml — per-repo agent policy
#
# Read from the DEFAULT branch (trunk), never from a PR head, so a pull
# request cannot loosen its own guardrails. Everything is optional.

version: 1

# Hard spend cap for a single run, in USD cents. The pipeline halts cleanly
# once estimated LLM spend reaches this cap. Omit to disable.
budget:
  maxUsdCents: 200   # $2.00 per run

# Autonomy floor:  full | mentor | dry-run
autonomy: full

# Human-approval gate:  manual | trust | auto
approval: trust
`;

export async function installExamplePolicy(cfg: GitHubConfig): Promise<void> {
  await ghPutFile(cfg, ".qodo/policy.yml", encodeUtf8Base64(EXAMPLE_POLICY), "Add agent policy (from example) via Mission Control");
}
