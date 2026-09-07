import { sha256 } from '../contracts/crypto.js';

export interface PolicyDecisionEvidence { readonly policyEngine: 'OPA-compatible'; readonly policyDigest: string; readonly inputDigest: string; readonly repeatedDecisionDigest: string; readonly decisionDigest: string; readonly deniedRules: readonly string[]; readonly undefinedRules: readonly string[]; readonly observed: boolean; }
export function evaluatePolicyEvidence(input: PolicyDecisionEvidence, expected: { policyDigest: string; inputDigest: string }): { status: 'PASS' | 'BLOCK'; failures: readonly string[]; reportDigest: string } {
  const failures: string[] = [];
  if (input.policyDigest !== expected.policyDigest) failures.push('policy_digest_mismatch');
  if (input.inputDigest !== expected.inputDigest) failures.push('policy_input_digest_mismatch');
  if (input.decisionDigest !== input.repeatedDecisionDigest) failures.push('policy_nondeterministic');
  if (input.deniedRules.length) failures.push('policy_denied');
  if (input.undefinedRules.length) failures.push('policy_undefined');
  if (!input.observed) failures.push('policy_evidence_not_observed');
  const material = { status: failures.length ? 'BLOCK' as const : 'PASS' as const, failures: [...new Set(failures)].sort() };
  return { ...material, reportDigest: sha256(material) };
}

export interface FormalModelEvidence { readonly modelChecker: 'TLC'; readonly specDigest: string; readonly implementationDigest: string; readonly refinementMapDigest: string; readonly invariantIds: readonly string[]; readonly statesGenerated: number; readonly distinctStates: number; readonly deadlockFound: boolean; readonly invariantViolations: number; readonly errors: number; readonly observed: boolean; }
export function evaluateFormalModelEvidence(input: FormalModelEvidence, expected: { specDigest: string; implementationDigest: string; requiredInvariants: readonly string[] }): { status: 'PASS' | 'BLOCK'; failures: readonly string[]; reportDigest: string } {
  const failures: string[] = [];
  if (input.specDigest !== expected.specDigest) failures.push('spec_digest_mismatch');
  if (input.implementationDigest !== expected.implementationDigest) failures.push('implementation_digest_mismatch');
  if (!/^[0-9a-f]{64}$/.test(input.refinementMapDigest)) failures.push('refinement_map_missing');
  for (const invariant of expected.requiredInvariants) if (!input.invariantIds.includes(invariant)) failures.push(`invariant_missing:${invariant}`);
  if (input.statesGenerated <= 0 || input.distinctStates <= 0 || input.distinctStates > input.statesGenerated) failures.push('state_space_invalid');
  if (input.deadlockFound) failures.push('deadlock_found');
  if (input.invariantViolations > 0) failures.push('invariant_violation');
  if (input.errors > 0) failures.push('model_checker_error');
  if (!input.observed) failures.push('model_evidence_not_observed');
  const material = { status: failures.length ? 'BLOCK' as const : 'PASS' as const, failures: [...new Set(failures)].sort() };
  return { ...material, reportDigest: sha256(material) };
}

export interface FuzzCampaignEvidence { readonly targetDigest: string; readonly corpusDigest: string; readonly seed: number; readonly executions: number; readonly uniquePaths: number; readonly durationMs: number; readonly crashes: number; readonly sanitizerFindings: number; readonly timeoutCount: number; readonly minimalReproducers: number; readonly deterministicReplay: boolean; readonly observed: boolean; }
export function evaluateFuzzEvidence(input: FuzzCampaignEvidence, expected: { targetDigest: string; minimumExecutions: number; minimumUniquePaths: number; maximumTimeouts: number }): { status: 'PASS' | 'BLOCK'; failures: readonly string[]; reportDigest: string } {
  const failures: string[] = [];
  if (input.targetDigest !== expected.targetDigest) failures.push('fuzz_target_digest_mismatch');
  if (!/^[0-9a-f]{64}$/.test(input.corpusDigest)) failures.push('corpus_digest_invalid');
  if (!Number.isSafeInteger(input.seed)) failures.push('seed_invalid');
  if (input.executions < expected.minimumExecutions) failures.push('execution_budget_insufficient');
  if (input.uniquePaths < expected.minimumUniquePaths) failures.push('path_diversity_insufficient');
  if (input.durationMs <= 0) failures.push('duration_invalid');
  if (input.crashes > 0 || input.sanitizerFindings > 0) failures.push('fuzz_failures_found');
  if (input.timeoutCount > expected.maximumTimeouts) failures.push('timeout_budget_exceeded');
  if (input.crashes > 0 && input.minimalReproducers < input.crashes) failures.push('reproducer_missing');
  if (!input.deterministicReplay) failures.push('replay_not_deterministic');
  if (!input.observed) failures.push('fuzz_evidence_not_observed');
  const material = { status: failures.length ? 'BLOCK' as const : 'PASS' as const, failures: [...new Set(failures)].sort() };
  return { ...material, reportDigest: sha256(material) };
}
