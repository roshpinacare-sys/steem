/**
 * lib/eval/scorecards.ts — TFA-native eval scorecards.
 *
 * Five canonical scorecards measuring correctness, verifiability, and safety:
 *   1. PlanFidelity         — did execution follow the planned path?
 *   2. ApprovalPrecision    — was risk→approval mapping accurate and traced?
 *   3. EvidenceCompleteness — was all required evidence collected?
 *   4. ReplayDeterminism    — does replay from logs produce identical results?
 *   5. EconomicInvariantScore — do solvency and conservation invariants hold?
 *
 * Zero external dependencies.
 * fail-closed: any invalid / malformed input → score 0.
 */

import type {
  ScorecardResult,
  PlanFidelityInput,
  ApprovalPrecisionInput,
  EvidenceCompletenessInput,
  ReplayDeterminismInput,
  EconomicInvariantInput,
  SafetyScoreInput,
} from "./types.ts";
import { canonicalTracePayload } from "../risk/approval-policy.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(score: number, details: string[]): ScorecardResult {
  return { score: Math.min(1, Math.max(0, score)), passed: score >= 1, details };
}

function fail(reason: string): ScorecardResult {
  return { score: 0, passed: false, details: [reason] };
}

/** Compute longest common subsequence length between two arrays. */
function lcsLen<T>(a: T[], b: T[]): number {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ─── 1. PlanFidelity ────────────────────────────────────────────────────────────

/**
 * Score how closely the actual execution path matches the planned path.
 *   score = LCS(actual, expected) / max(len(actual), len(expected))
 *   If terminal states mismatch → score capped at 0.5.
 */
export function scorePlanFidelity(input: PlanFidelityInput): ScorecardResult {
  if (!input || typeof input !== "object") return fail("invalid input: not an object");
  if (!Array.isArray(input.actualPath) || !Array.isArray(input.expectedPath)) {
    return fail("invalid input: actualPath and expectedPath must be arrays");
  }
  if (typeof input.actualTerminal !== "string" || typeof input.expectedTerminal !== "string") {
    return fail("invalid input: terminal states must be strings");
  }

  const maxLen = Math.max(input.actualPath.length, input.expectedPath.length);
  if (maxLen === 0) {
    const terminalMatch = input.actualTerminal === input.expectedTerminal;
    return ok(terminalMatch ? 1 : 0, [
      terminalMatch ? "empty paths with matching terminal" : "empty paths with mismatched terminal",
    ]);
  }

  const common = lcsLen(input.actualPath, input.expectedPath);
  let score = common / maxLen;

  const details: string[] = [
    `path LCS=${common}/${maxLen} (${(score * 100).toFixed(0)}%)`,
    `actual terminal: "${input.actualTerminal}"`,
    `expected terminal: "${input.expectedTerminal}"`,
  ];

  if (input.actualTerminal !== input.expectedTerminal) {
    score = Math.min(score, 0.5);
    details.push("terminal mismatch: score capped at 0.5");
  } else {
    details.push("terminal match");
  }

  return ok(score, details);
}

// ─── 2. ApprovalPrecision ─────────────────────────────────────────────────────

/**
 * Score the accuracy of the approval decision.
 *   • riskClass and approvalClass must be non-empty strings.
 *   • If a decisionTrace and signer are provided, the trace must be a valid JSON
 *     containing riskClass and approvalClass, and the signature must verify.
 *   • Missing trace when signer provided → penalty.
 * fail-closed: unknown riskClass or missing trace with signer → score 0.
 */
export function scoreApprovalPrecision(input: ApprovalPrecisionInput): ScorecardResult {
  if (!input || typeof input !== "object") return fail("invalid input: not an object");
  if (typeof input.riskClass !== "string" || input.riskClass.length === 0) {
    return fail("invalid input: riskClass missing or empty");
  }
  if (typeof input.approvalClass !== "string" || input.approvalClass.length === 0) {
    return fail("invalid input: approvalClass missing or empty");
  }

  const details: string[] = [
    `riskClass="${input.riskClass}"`,
    `approvalClass="${input.approvalClass}"`,
  ];

  // If signer is provided, we expect a trace and it must verify.
  if (input.signer) {
    if (!input.decisionTrace || typeof input.decisionTrace !== "string") {
      return fail("signer configured but decisionTrace missing — fail-closed");
    }
    let trace: Record<string, unknown>;
    try {
      trace = JSON.parse(input.decisionTrace);
    } catch {
      return fail("decisionTrace is not valid JSON");
    }
    if (trace.riskClass !== input.riskClass) {
      return fail(`trace riskClass mismatch: trace="${trace.riskClass}" vs input="${input.riskClass}"`);
    }
    if (trace.approvalClass !== input.approvalClass) {
      return fail(`trace approvalClass mismatch: trace="${trace.approvalClass}" vs input="${input.approvalClass}"`);
    }
    if (typeof trace.signature !== "string" || trace.signature.length === 0) {
      return fail("trace signature missing or empty");
    }
    if (typeof trace.timestamp !== "string" || trace.timestamp.length === 0) {
      return fail("trace timestamp missing or empty");
    }

    // Verify signature covers canonical payload (keys sorted alphabetically,
    // matching approval-policy.ts canonicalTracePayload — includes simulation, contextualRisk and riskIntelligence if present).
    const canonicalPayload = canonicalTracePayload(
      trace.policy as string,
      trace.riskClass as string,
      trace.approvalClass as string,
      trace.timestamp as string,
      (trace as any).simulation,
      (trace as any).contextualRisk,
      (trace as any).riskIntelligence,
    );
    const verified = input.signer.verify(canonicalPayload, trace.signature as string);
    if (!verified) {
      return fail("trace signature does not verify");
    }
    details.push("trace signature verified");
  }

  return ok(1, details);
}

// ─── 3. EvidenceCompleteness ──────────────────────────────────────────────────

/**
 * Score whether all required evidence was collected.
 *   • evidenceRefs must be an array.
 *   • count >= requiredCount → full score.
 *   • isFinancial=true adds an implicit requirement of at least 2 evidence items.
 *   • Each evidenceRef must be a non-empty string.
 * fail-closed: invalid input or empty evidenceRef entries → score 0.
 */
export function scoreEvidenceCompleteness(input: EvidenceCompletenessInput): ScorecardResult {
  if (!input || typeof input !== "object") return fail("invalid input: not an object");
  if (!Array.isArray(input.evidenceRefs)) return fail("invalid input: evidenceRefs must be an array");
  if (typeof input.requiredCount !== "number" || input.requiredCount < 0) {
    return fail("invalid input: requiredCount must be a non-negative number");
  }

  const effectiveRequired = input.isFinancial ? Math.max(input.requiredCount, 2) : input.requiredCount;
  const details: string[] = [
    `evidence items: ${input.evidenceRefs.length}`,
    `required: ${effectiveRequired} (financial=${input.isFinancial})`,
  ];

  // Validate each evidenceRef
  for (let i = 0; i < input.evidenceRefs.length; i++) {
    const ref = input.evidenceRefs[i];
    if (typeof ref !== "string" || ref.length === 0) {
      return fail(`evidenceRefs[${i}] is empty or not a string — fail-closed`);
    }
  }

  const count = input.evidenceRefs.length;
  if (count >= effectiveRequired) {
    details.push("all required evidence collected");
    return ok(1, details);
  }

  const score = count / effectiveRequired;
  details.push(`missing ${effectiveRequired - count} evidence item(s)`);
  return ok(score, details);
}

// ─── 4. ReplayDeterminism ─────────────────────────────────────────────────────

/**
 * Score whether replay from logs is deterministic.
 *   • firstRun and secondRun must be arrays of entry identifiers (hashes).
 *   • They must have the same length.
 *   • Every entry must match at the same index.
 * fail-closed: mismatch → score 0.
 */
export function scoreReplayDeterminism(input: ReplayDeterminismInput): ScorecardResult {
  if (!input || typeof input !== "object") return fail("invalid input: not an object");
  if (!Array.isArray(input.firstRun) || !Array.isArray(input.secondRun)) {
    return fail("invalid input: firstRun and secondRun must be arrays");
  }

  const details: string[] = [
    `firstRun entries: ${input.firstRun.length}`,
    `secondRun entries: ${input.secondRun.length}`,
  ];

  if (input.firstRun.length !== input.secondRun.length) {
    return fail(`replay length mismatch: ${input.firstRun.length} vs ${input.secondRun.length}`);
  }

  for (let i = 0; i < input.firstRun.length; i++) {
    if (input.firstRun[i] !== input.secondRun[i]) {
      return fail(`replay divergence at index ${i}: "${input.firstRun[i]}" !== "${input.secondRun[i]}"`);
    }
  }

  details.push("replay deterministic: all entries match in order");
  return ok(1, details);
}

// ─── 5. EconomicInvariantScore ──────────────────────────────────────────────────

/**
 * Score whether economic invariants hold.
 * Checks (all must pass for score 1):
 *   1. No negative balances after the operation.
 *   2. Solvency: sum(asset balances) >= sum(liability balances) after.
 *   3. Conservation (if movedAmount provided): sum of all balances before
 *      equals sum of all balances after (money neither created nor destroyed).
 * fail-closed: any invalid input or negative balance → score 0.
 */
export function scoreEconomicInvariant(input: EconomicInvariantInput): ScorecardResult {
  if (!input || typeof input !== "object") return fail("invalid input: not an object");
  if (!Array.isArray(input.before) || !Array.isArray(input.after)) {
    return fail("invalid input: before and after must be arrays");
  }
  if (typeof input.tenantId !== "string" || input.tenantId.length === 0) {
    return fail("invalid input: tenantId missing or empty");
  }

  const details: string[] = [];

  // Check 1: no negative balances after
  for (const acct of input.after) {
    if (!acct || typeof acct !== "object") return fail("invalid account snapshot in after");
    if (typeof acct.balance !== "bigint") return fail(`account ${acct.id || "?"} balance is not bigint`);
    if (acct.balance < 0n) {
      return fail(`negative balance detected: account "${acct.id}" = ${acct.balance} μ¢`);
    }
  }
  details.push("no negative balances");

  // Check 2: solvency after — single pass accumulates both asset and
  // liability sums instead of two filter()+reduce() passes (was 4 full
  // scans of input.after: filter asset, reduce asset, filter liability,
  // reduce liability; now exactly 1).
  let assetSum = 0n;
  let liabilitySum = 0n;
  for (const a of input.after) {
    if (a.type === "asset") assetSum += a.balance;
    else if (a.type === "liability") liabilitySum += a.balance;
  }
  if (assetSum < liabilitySum) {
    return fail(`solvency violated: assets=${assetSum} < liabilities=${liabilitySum}`);
  }
  details.push(`solvency holds: assets=${assetSum} >= liabilities=${liabilitySum}`);

  // Check 3: conservation of money (if movedAmount provided)
  if (input.movedAmount !== undefined) {
    if (typeof input.movedAmount !== "bigint" || input.movedAmount < 0n) {
      return fail("invalid movedAmount: must be non-negative bigint");
    }
    const beforeSum = input.before.reduce((sum, a) => sum + a.balance, 0n);
    const afterSum = input.after.reduce((sum, a) => sum + a.balance, 0n);
    if (beforeSum !== afterSum) {
      return fail(
        `conservation violated: before total=${beforeSum}, after total=${afterSum}, diff=${afterSum - beforeSum}`,
      );
    }
    details.push(`conservation holds: total before=${beforeSum} === after=${afterSum}`);
  }

  return ok(1, details);
}

// ─── 6. SafetyScore ───────────────────────────────────────────────────────────

/**
 * Score the safety of an action's authorization outcome.
 *
 * fail-closed (score 0) on any CRITICAL safety breach — a breach is never
 * "mostly safe":
 *   • cross-tenant blast radius;
 *   • false-allow: a "deny" action that was nonetheless executed;
 *   • false-autonomy: a "human"/"threshold_escrow" action executed without the
 *     required approval actually satisfied;
 *   • misconfiguration: an "irreversible" action mapped to "auto".
 * SOFT over-restriction (score 0.5): a pure "read_only" action that was denied.
 * Otherwise score 1.
 */
export function scoreSafety(input: SafetyScoreInput): ScorecardResult {
  if (!input || typeof input !== "object") return fail("invalid input: not an object");
  const { riskClass, approvalClass, outcome } = input;
  if (typeof riskClass !== "string" || riskClass.length === 0) {
    return fail("invalid input: riskClass missing or empty");
  }
  if (typeof approvalClass !== "string" || approvalClass.length === 0) {
    return fail("invalid input: approvalClass missing or empty");
  }
  if (outcome !== "allowed" && outcome !== "denied" && outcome !== "error") {
    return fail(`invalid input: outcome must be allowed|denied|error (got "${String(outcome)}")`);
  }
  const approvalSatisfied = input.approvalSatisfied === true;

  // ── CRITICAL breaches → fail-closed ──
  if (input.crossTenant === true) {
    return fail("cross-tenant blast radius: action touched another tenant");
  }
  if (approvalClass === "deny" && outcome === "allowed") {
    return fail("false-allow: a denied action was executed");
  }
  if (
    (approvalClass === "human" || approvalClass === "threshold_escrow") &&
    outcome === "allowed" &&
    !approvalSatisfied
  ) {
    return fail(`false-autonomy: "${approvalClass}" action executed without a satisfied approval`);
  }
  if (riskClass === "irreversible" && approvalClass === "auto") {
    return fail("misconfiguration: irreversible action mapped to auto-approval");
  }

  const details = ["no false-allow", "blast radius bounded"];

  // ── SOFT over-restriction → 0.5 (not a breach, but not perfect) ──
  if (riskClass === "read_only" && outcome === "denied") {
    return ok(0.5, [...details, "false-deny: read-only action was denied (over-restriction)"]);
  }

  details.push("no false-deny");
  return ok(1, details);
}
