import { sha256 } from '../contracts/crypto.js';

interface SemanticImpactLike { readonly status: 'PASS' | 'BLOCK'; readonly changedNodeIds: readonly string[]; readonly impactedFiles: readonly string[]; readonly evidenceObligations: readonly string[]; readonly rollbackRequired: boolean; readonly decisionDigest: string; }
interface ChangeImpactLike { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly changes: number }; readonly reportDigest: string; }
interface VerificationPlanLike { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly changedFiles: number; readonly impactedCapabilities: number; readonly selectedTests: number }; readonly impactedCapabilities: readonly string[]; readonly reportDigest: string; }
interface ProofDiversityLike { readonly status: 'PASS' | 'BLOCK'; readonly reportDigest: string; }
interface IntegrationContractLike { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly closedEdges: number }; readonly reportDigest: string; }
interface FaultCampaignLike { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly scenarios: number }; readonly reportDigest: string; }
interface ClaimClosureLike { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly closedClaims: number }; readonly reportDigest: string; }

export interface GovernedReleaseAssuranceInput {
  readonly changeImpactDecision: SemanticImpactLike;
  readonly changeImpactReport: ChangeImpactLike;
  readonly verificationPlan: VerificationPlanLike;
  readonly proofDiversity: ProofDiversityLike;
  readonly integrationContracts: IntegrationContractLike;
  readonly faultCampaign: FaultCampaignLike;
  readonly claimClosure: ClaimClosureLike;
  readonly satisfiedEvidenceObligations: readonly string[];
  readonly rollbackVerified: boolean;
  readonly evidenceIdentityCoherent: boolean;
  readonly externalBlockers: readonly string[];
}

export interface GovernedReleaseAssuranceDecision {
  readonly status: 'PASS_WITH_EXTERNAL_BLOCKERS' | 'BLOCK';
  readonly localDisposition: 'READY_FOR_EXTERNAL_QUALIFICATION' | 'BLOCKED';
  readonly productionPromotion: 'BLOCKED';
  readonly failures: readonly string[];
  readonly externalBlockers: readonly string[];
  readonly metrics: {
    readonly impactedFiles: number;
    readonly impactedCapabilities: number;
    readonly selectedTests: number;
    readonly closedClaims: number;
    readonly closedIntegrations: number;
    readonly faultScenarios: number;
  };
  readonly inputDigests: readonly string[];
  readonly decisionDigest: string;
}

/**
 * Aggregates local assurance without granting release authority. Production
 * promotion remains blocked even when every repository-local proof passes.
 */
export function evaluateGovernedReleaseAssurance(input: GovernedReleaseAssuranceInput): GovernedReleaseAssuranceDecision {
  const failures: string[] = [];
  if (input.changeImpactDecision.status !== 'PASS') failures.push('semantic_change_impact_blocked');
  if (input.changeImpactReport.status !== 'PASS') failures.push('change_governance_blocked');
  if (input.verificationPlan.status !== 'PASS') failures.push('verification_plan_blocked');
  if (input.proofDiversity.status !== 'PASS') failures.push('proof_diversity_blocked');
  if (input.integrationContracts.status !== 'PASS') failures.push('integration_contracts_blocked');
  if (input.faultCampaign.status !== 'PASS') failures.push('integration_fault_campaign_blocked');
  if (input.claimClosure.status !== 'PASS') failures.push('claim_closure_blocked');
  if (!input.evidenceIdentityCoherent) failures.push('evidence_identity_incoherent');
  if (input.changeImpactDecision.rollbackRequired && !input.rollbackVerified) failures.push('rollback_not_verified');

  const satisfied = new Set(input.satisfiedEvidenceObligations.map((value) => value.trim()).filter(Boolean));
  for (const obligation of input.changeImpactDecision.evidenceObligations) if (!satisfied.has(obligation)) failures.push(`evidence_obligation_unsatisfied:${obligation}`);
  const capabilities = new Set(input.verificationPlan.impactedCapabilities);
  if (input.changeImpactDecision.impactedFiles.length !== input.verificationPlan.metrics.changedFiles) failures.push('changed_file_inventory_mismatch');
  if (input.changeImpactReport.metrics.changes !== input.changeImpactDecision.changedNodeIds.length) failures.push('change_inventory_mismatch');
  if (capabilities.size === 0) failures.push('impacted_capability_missing');
  if (input.verificationPlan.metrics.selectedTests === 0) failures.push('selected_tests_missing');

  const externalBlockers = sortedUnique(input.externalBlockers);
  const inputDigests = [
    input.changeImpactDecision.decisionDigest,
    input.changeImpactReport.reportDigest,
    input.verificationPlan.reportDigest,
    input.proofDiversity.reportDigest,
    input.integrationContracts.reportDigest,
    input.faultCampaign.reportDigest,
    input.claimClosure.reportDigest,
  ].sort();
  const material = {
    status: failures.length === 0 ? 'PASS_WITH_EXTERNAL_BLOCKERS' as const : 'BLOCK' as const,
    localDisposition: failures.length === 0 ? 'READY_FOR_EXTERNAL_QUALIFICATION' as const : 'BLOCKED' as const,
    productionPromotion: 'BLOCKED' as const,
    failures: [...new Set(failures)].sort(),
    externalBlockers,
    metrics: {
      impactedFiles: input.changeImpactDecision.impactedFiles.length,
      impactedCapabilities: input.verificationPlan.metrics.impactedCapabilities,
      selectedTests: input.verificationPlan.metrics.selectedTests,
      closedClaims: input.claimClosure.metrics.closedClaims,
      closedIntegrations: input.integrationContracts.metrics.closedEdges,
      faultScenarios: input.faultCampaign.metrics.scenarios,
    },
    inputDigests,
  };
  return { ...material, decisionDigest: sha256(material) };
}
function sortedUnique(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(); }
