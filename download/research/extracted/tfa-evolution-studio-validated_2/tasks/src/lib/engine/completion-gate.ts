/**
 * TFA Evolution Studio v28 — Completion Gate
 *
 * Enforces the 80% pass threshold (V14+) before a cycle
 * can be considered complete.
 */

import type { CycleEvidenceChain } from "@/lib/types";

export interface CompletionGateResult {
  passed: boolean;
  passRate: number;
  threshold: number;
  reason?: string;
}

export function evaluateCompletionGate(chain: CycleEvidenceChain): CompletionGateResult {
  const passRate = chain.passRate;
  if (passRate >= 0.8) {
    return { passed: true, passRate, threshold: 0.8 };
  }
  return {
    passed: false,
    passRate,
    threshold: 0.8,
    reason: `Pass rate ${(passRate * 100).toFixed(1)}% is below threshold 80%`,
  };
}
