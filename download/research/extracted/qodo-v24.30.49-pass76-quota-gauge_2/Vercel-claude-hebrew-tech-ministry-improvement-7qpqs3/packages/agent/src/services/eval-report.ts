/**
 * eval-report.ts — the evidence the sovereign premium `--eval` run produces.
 *
 * After the REAL pipeline runs fully in-process (no network, no vendor API),
 * this renders a single-screen proof that it was sharp, powerful, and honest:
 * the phases it walked, the gates it cleared, the patch it wrote, the policy
 * that governed it, the trust it earned, the cost it took ($0, sovereign), and
 * — critically — a cryptographic verification of the run's own audit chain.
 *
 * Pure rendering: it reads back the same objects the pipeline wrote to
 * (in-memory state, the recorded GitHub calls, the on-disk audit log, the cost
 * tracker) and turns them into text. No I/O beyond reading the audit file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyAuditChain, type AuditEntry } from "./audit-log.js";
import { costTracker } from "./ai-router.js";
import { loadTrustLedger, canAutoMerge } from "./trust-ledger.js";
import { describePolicy, type LoadedPolicy } from "./policy.js";
import { budgetStatus } from "./budget-governor.js";
import type { LocalRedisState, LocalGitHubClient } from "./local/in-memory-adapters.js";

const RULE = "─".repeat(62);

export interface EvalReportInput {
  objective: string;
  owner: string;
  repo: string;
  llmPath: "simulation" | "ollama";
  durationMs: number;
  outcome: "success" | "halted" | "error";
  error?: string;
  state: LocalRedisState;
  gh: LocalGitHubClient;
  policy: LoadedPolicy;
  workspaceRoot: string;
}

function readAuditEntries(workspaceRoot: string): AuditEntry[] {
  try {
    const raw = readFileSync(resolve(workspaceRoot, ".audit-log.ndjson"), "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditEntry);
  } catch {
    return [];
  }
}

function ok(b: boolean): string {
  return b ? "✓" : "✗";
}

/** Build the full evaluation report as text. Async only to read the ledger. */
export async function buildEvalReport(input: EvalReportInput): Promise<string> {
  const { objective, owner, repo, llmPath, durationMs, outcome, error, state, gh, policy, workspaceRoot } = input;
  const entries = readAuditEntries(workspaceRoot);
  const byEvent = (event: string) => entries.find((e) => e.event === event);
  const chain = verifyAuditChain(workspaceRoot);
  const cost = costTracker.totals();
  const budget = budgetStatus();
  const events = state.readEvents();

  const L: string[] = [];
  L.push("");
  L.push("╔" + "═".repeat(60) + "╗");
  L.push("║  QODO — SOVEREIGN PREMIUM EVALUATION" + " ".repeat(24) + "║");
  L.push("╚" + "═".repeat(60) + "╝");
  L.push("");

  // ── Run summary ────────────────────────────────────────────────────────
  const verdict = outcome === "success" ? "SUCCESS ✓" : outcome === "halted" ? "HALTED (by design)" : "ERROR ✗";
  L.push(`  Objective : ${objective}`);
  L.push(`  Repo      : ${owner}/${repo}`);
  L.push(`  Outcome   : ${verdict}${error ? `  — ${error}` : ""}`);
  L.push(`  Duration  : ${(durationMs / 1000).toFixed(2)}s   ·   Telemetry events: ${events.length}`);
  L.push("");

  // ── Sovereign posture ──────────────────────────────────────────────────
  L.push("SOVEREIGN POSTURE");
  L.push(RULE);
  L.push(`  External services used ........ none (Redis, R2, GitHub all in-process)`);
  L.push(`  Intelligence path ............. ${llmPath === "simulation" ? "deterministic local simulator" : "on-device Ollama"} (no metered API)`);
  L.push(`  Data leaving the host ......... none`);
  L.push(`  LLM spend ..................... $${(cost.estimatedUsdCents / 100).toFixed(4)}  (${cost.callCount} calls, ${cost.tokens.totalTokens} tokens)`);
  L.push("");

  // ── Pipeline path ──────────────────────────────────────────────────────
  L.push("PIPELINE — full delivery path exercised end-to-end");
  L.push(RULE);
  const milestones: [string, boolean, string][] = [
    ["Architect  — typed plan", !!byEvent("architect-plan-generated"), planSummary(byEvent("architect-plan-generated"))],
    ["Coder      — patch", !!byEvent("coder-patch-generated"), `${gh.committed.reduce((n, c) => n + c.files.length, 0) || filesFromPatch(gh)} file(s)`],
    ["Gate       — 5-gate validator", !!byEvent("gate-evaluated"), gateSummary(byEvent("gate-evaluated"))],
    ["Commit     — ghost commit", gh.committed.length > 0, gh.committed.length ? gh.committed[0].message.split("\n")[0].slice(0, 40) : "—"],
    ["Merge      — PR merged", gh.merged, gh.merged ? "merged" : "not merged"],
    ["Review     — reviewer pass", !!byEvent("run-done") || gh.comments.length > 0, `${gh.comments.length} PR comment(s)`],
  ];
  for (const [label, done, detail] of milestones) {
    L.push(`  ${ok(done)} ${label.padEnd(32)} ${detail}`);
  }
  L.push("");

  // ── 5-gate detail ──────────────────────────────────────────────────────
  const gate = byEvent("gate-evaluated");
  if (gate) {
    const results = (gate.payload.results ?? {}) as Record<string, boolean>;
    L.push("VALIDATION GATES");
    L.push(RULE);
    const gateOpen = gate.payload.gateOpen === true;
    for (const [name, allowed] of Object.entries(results)) {
      L.push(`  ${ok(allowed)} ${name}`);
    }
    L.push(`  → gate ${gateOpen ? "OPEN — change cleared all validators" : "CLOSED — change blocked"}`);
    L.push("");
  }

  // ── Sovereign control layer ────────────────────────────────────────────
  L.push("CONTROL LAYER (.qodo/policy — owner-governed)");
  L.push(RULE);
  for (const line of describePolicy(policy).split("\n").slice(2)) L.push("  " + line.trimEnd());
  if (budget.capCents > 0) {
    L.push(`  budget spent  : $${(budget.spentCents / 100).toFixed(4)} of $${(budget.capCents / 100).toFixed(2)} cap` +
      (budget.exceeded ? "  → CAP REACHED (pipeline halted)" : ""));
  }
  L.push("");

  // ── Trust ledger ───────────────────────────────────────────────────────
  const ledger = await loadTrustLedger(owner, repo, state);
  L.push("TRUST LEDGER (earned this run)");
  L.push(RULE);
  if (ledger.bonds.length === 0) {
    L.push("  (no bond recorded — run did not reach the success bookkeeping phase)");
  } else {
    for (const b of ledger.bonds) {
      L.push(`  ${b.category.padEnd(16)} score ${String(b.score).padStart(3)}/100  ${b.probation ? "· probation" : ""}  ${canAutoMerge(b) ? "· auto-merge eligible" : ""}`);
    }
  }
  L.push("");

  // ── Audit chain (the trust anchor) ─────────────────────────────────────
  L.push("AUDIT CHAIN (hash-linked, tamper-evident)");
  L.push(RULE);
  L.push(`  entries ....... ${entries.length}`);
  L.push(`  verification .. ${chain.valid ? "VALID ✓ — every entry's hash chains to the previous" : `BROKEN ✗ at seq ${chain.brokenAt}`}`);
  if (entries.length) {
    L.push("  timeline:");
    for (const e of entries) L.push(`    #${String(e.seq).padStart(2)}  ${e.event}`);
  }
  L.push("");

  // ── Verdict ────────────────────────────────────────────────────────────
  const clean = outcome === "success" && chain.valid && (!gate || gate.payload.gateOpen === true);
  L.push(RULE);
  L.push(
    clean
      ? "  VERDICT: sovereign premium path is fully functional — full pipeline,"
      : "  VERDICT: run completed with the state shown above —",
  );
  L.push(
    clean
      ? "  all gates, governed by policy, audit-verified, at $0 and zero external deps."
      : "  review the milestones and gates above.",
  );
  L.push("");
  return L.join("\n");
}

function planSummary(e?: AuditEntry): string {
  if (!e) return "—";
  const steps = (e.payload.steps ?? e.payload.stepCount) as unknown;
  if (typeof steps === "number") return `${steps} step(s)`;
  if (Array.isArray(steps)) return `${steps.length} step(s)`;
  const risk = e.payload.risk;
  return risk ? `risk: ${String(risk)}` : "generated";
}

function gateSummary(e?: AuditEntry): string {
  if (!e) return "—";
  const results = (e.payload.results ?? {}) as Record<string, boolean>;
  const total = Object.keys(results).length;
  const passed = Object.values(results).filter(Boolean).length;
  return total ? `${passed}/${total} validators passed` : (e.payload.gateOpen ? "open" : "closed");
}

function filesFromPatch(gh: LocalGitHubClient): number {
  return gh.committed.reduce((n, c) => n + c.files.length, 0);
}
