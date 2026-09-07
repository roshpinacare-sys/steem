/**
 * TFA Evolution Studio v28 — Release Gate
 *
 * Evaluates whether a release is ready to publish by checking required
 * evidence nodes. All blockers must be cleared before a release ZIP is
 * produced.
 *
 * V23 fix: evidence status comparison was incorrectly using "pass" instead
 * of the canonical "passed" status defined in EvidenceNode. This meant
 * passedNodes was always empty and the gate always reported blockers even
 * when all evidence had genuinely passed. Fixed to use "passed".
 *
 * V23 additions:
 *   - New required evidence nodes: workflow_replayable, synthesis_loop_converged,
 *     batch_reconciled, self_audit_clean (promoted from V22 to hard gates).
 *   - `buildGateEvidence()` — emits a release_gate_passed evidence node so
 *     the chain records the gate result as structured evidence.
 */

import type { EvidenceNode } from "@/lib/types";

export interface ReleaseGateResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  checkedAt: string;
}

// Evidence nodes that MUST be present and passing before a release is allowed.
const REQUIRED_RELEASE_EVIDENCE = [
  "zip_integrity_verified",
  "artifact_hash_verified",
  "manifest_version_consistent",
  "version_coherence_verified",
  "smoke_test_exists",
  "workflow_replayable",
  "synthesis_loop_converged",
  "batch_reconciled",
  "self_audit_clean",
] as const;

export function evaluateReleaseGate(evidence: EvidenceNode[]): ReleaseGateResult {
  // V23 fix: use "passed" (canonical status) not "pass" (typo from V21)
  const passedKinds = new Set(
    evidence.filter((e) => e.status === "passed").map((e) => e.kind)
  );

  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const required of REQUIRED_RELEASE_EVIDENCE) {
    if (!passedKinds.has(required)) {
      blockers.push(`Required evidence missing or not passing: ${required}`);
    }
  }

  const optionalEvidence = ["adapter_health_verified", "lint_clean", "tests_passed"];
  for (const opt of optionalEvidence) {
    if (!passedKinds.has(opt as EvidenceNode["kind"])) {
      warnings.push(`Optional evidence absent: ${opt}`);
    }
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Builds a structured evidence node recording the gate result.
 * Attach this to the cycle's evidence chain after calling evaluateReleaseGate.
 */
export function buildGateEvidence(result: ReleaseGateResult): EvidenceNode {
  return {
    kind: "release_gate_passed",
    status: result.passed ? "passed" : "failed",
    message: result.passed
      ? "Release gate passed — all required evidence nodes present and passing"
      : `Release gate blocked: ${result.blockers.join("; ")}`,
    timestamp: result.checkedAt,
    metadata: { blockers: result.blockers, warnings: result.warnings },
  };
}
