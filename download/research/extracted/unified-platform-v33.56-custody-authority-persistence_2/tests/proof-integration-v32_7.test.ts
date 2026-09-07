import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticChangeDag, type ChangeImpactDecision } from '../src/repository/semantic-change-dag.js';
import { evaluateChangeImpact, type ChangeImpactReport } from '../src/governance/change-impact-gate.js';
import { buildChangeVerificationPlan, type ChangeVerificationPlanReport } from '../src/validation/change-verification-plan.js';
import { evaluateProofDiversity, type ProofObservation, type ProofRequirement } from '../src/validation/proof-diversity.js';
import { evaluateIntegrationContractAssurance, type IntegrationContractEvidence } from '../src/validation/integration-contract-assurance.js';
import { evaluateIntegrationFaultCampaign, type IntegrationFaultScenario } from '../src/validation/integration-fault-campaign.js';
import { evaluateClaimEvidenceClosure } from '../src/platform/claim-evidence-closure.js';
import { evaluateGovernedReleaseAssurance } from '../src/validation/governed-release-assurance.js';

const requirement: ProofRequirement = {
  claimId: 'release-safe', criticality: 'critical',
  requiredTechniques: ['unit', 'property', 'mutation', 'integration', 'recovery', 'security'],
  requiredDefectClasses: ['authorization', 'rollback', 'replay'], minimumIndependentOracles: 2, minimumEnvironments: 2, requireObserved: true,
};
const proof = (proofId: string, technique: ProofObservation['technique'], oracleId: string, environmentId: string, defectClasses: string[], patch: Partial<ProofObservation> = {}): ProofObservation => ({
  proofId, claimIds: ['release-safe'], technique, oracleId, environmentId, evidenceRef: `evidence/${proofId}.json`, defectClasses,
  current: true, authentic: true, complete: true, observed: true, ...patch,
});
const goodProofs = (): ProofObservation[] => [
  proof('p-unit', 'unit', 'assert-oracle', 'node-local', ['authorization']),
  proof('p-property', 'property', 'property-oracle', 'node-local', ['replay']),
  proof('p-mutation', 'mutation', 'mutation-oracle', 'sandbox', ['authorization']),
  proof('p-integration', 'integration', 'contract-oracle', 'sandbox', ['replay']),
  proof('p-recovery', 'recovery', 'state-oracle', 'node-local', ['rollback']),
  proof('p-security', 'security', 'signature-oracle', 'sandbox', ['authorization']),
];

const contract = (patch: Partial<IntegrationContractEvidence> = {}): IntegrationContractEvidence => ({
  edgeId: 'change-to-release', sourceCapability: 'change-assurance', targetCapability: 'release-assurance', contractVersion: '1.0.0', criticality: 'critical',
  ownerIds: ['owner-a'], reviewerIds: ['reviewer-b', 'reviewer-c'], stateful: true, crossTenant: true, authorityBearing: true,
  successTestRefs: ['tests/success'], rejectionTestRefs: ['tests/reject'], timeoutTestRefs: ['tests/timeout'], replayTestRefs: ['tests/replay'],
  concurrencyTestRefs: ['tests/concurrency'], tamperTestRefs: ['tests/tamper'], rollbackTestRefs: ['tests/rollback'], tenantIsolationTestRefs: ['tests/tenant'],
  observabilityRefs: ['runbooks/change-release'], evidenceRefs: ['evidence/change-release.json'], ...patch,
});
const scenario = (fault: IntegrationFaultScenario['fault'], patch: Partial<IntegrationFaultScenario> = {}): IntegrationFaultScenario => ({
  scenarioId: `scenario-${fault}`, edgeId: 'change-to-release', fault, expectedDisposition: fault === 'dependency-unavailable' ? 'DEGRADE' : fault === 'timeout' ? 'RETRY' : 'BLOCK',
  observedDisposition: fault === 'dependency-unavailable' ? 'DEGRADE' : fault === 'timeout' ? 'RETRY' : 'BLOCK', residualSideEffects: 0,
  replaySafe: true, tenantLeak: false, durationMs: 5, evidenceRef: `evidence/fault-${fault}.json`, ...patch,
});
const goodScenarios = (): IntegrationFaultScenario[] => ['timeout', 'duplicate', 'reorder', 'tamper', 'partial-write', 'dependency-unavailable', 'tenant-confusion'].map((fault) => scenario(fault as IntegrationFaultScenario['fault']));

function localFlow(): { decision: ChangeImpactDecision; impact: ChangeImpactReport; plan: ChangeVerificationPlanReport } {
  const dag = new SemanticChangeDag([
    { nodeId: 'code', kind: 'code', summary: 'release evaluator', dependsOn: [], files: ['src/validation/governed-release-assurance.ts'], evidenceObligations: ['proof-diversity', 'fault-campaign'], risk: 'critical' },
    { nodeId: 'test', kind: 'test', summary: 'release tests', dependsOn: ['code'], files: ['tests/proof-integration-v32_7.test.ts'], evidenceObligations: ['test-report'], risk: 'high' },
    { nodeId: 'rollback', kind: 'rollback', summary: 'rollback', dependsOn: ['code'], files: ['docs/V32_7_PROOF_INTEGRATION_CLOSURE.md'], evidenceObligations: ['rollback-proof'], risk: 'critical' },
  ]);
  const decision = dag.assess(['code'], { maximumImpactedNodes: 5, maximumImpactedFiles: 5, sacredFiles: [], requireRollbackForRisk: ['critical'] });
  const impact = evaluateChangeImpact([{ artifactId: 'code', criticality: 'critical', requirementRefs: ['REQ-V32.7-1'], ownerIds: ['owner-a'], testRefs: ['proof-integration'], evidenceRefs: ['proof-diversity'], rollbackRef: 'rollback-proof', reviewerIds: ['reviewer-b', 'reviewer-c'] }]);
  const plan = buildChangeVerificationPlan({ changedFiles: decision.impactedFiles, mappings: [
    { sourcePattern: 'src/validation/**', capabilityIds: ['governed-release-assurance'], testRefs: ['proof-integration'], critical: true },
    { sourcePattern: 'tests/**', capabilityIds: ['proof-integration-tests'], testRefs: ['proof-integration'], critical: false },
    { sourcePattern: 'docs/**', capabilityIds: ['rollback-runbook'], testRefs: ['proof-integration'], critical: false },
  ], fullSuiteRef: 'full-suite' });
  return { decision, impact, plan };
}

function goodInputs() {
  const diversity = evaluateProofDiversity([requirement], goodProofs());
  const integration = evaluateIntegrationContractAssurance([contract()]);
  const faults = evaluateIntegrationFaultCampaign([contract()], goodScenarios());
  const claims = evaluateClaimEvidenceClosure([{ claimId: 'release-safe', dependsOnClaimIds: [], evidenceIds: ['e-release'], limitationIds: ['external-qualification-pending'] }], [{ evidenceId: 'e-release', current: true, authentic: true, complete: true }]);
  return { ...localFlow(), diversity, integration, faults, claims };
}

test('proof diversity closes a critical claim only with independent techniques oracles and environments', () => {
  const report = evaluateProofDiversity([requirement], goodProofs());
  assert.equal(report.status, 'PASS'); assert.equal(report.metrics.closedClaims, 1); assert.equal(report.results[0]!.techniques.length, 6);
});

test('proof diversity rejects stale or inauthentic proof instead of counting volume', () => {
  const observations = goodProofs().map((row, index) => index === 0 ? { ...row, current: false } : index === 1 ? { ...row, authentic: false } : row);
  const report = evaluateProofDiversity([requirement], observations);
  assert.equal(report.status, 'BLOCK'); assert.ok(report.results[0]!.reasons.some((value) => value.startsWith('technique_floor:')));
});

test('critical proof technique floor cannot be bypassed', () => {
  const report = evaluateProofDiversity([requirement], goodProofs().slice(0, 3));
  assert.equal(report.status, 'BLOCK'); assert.ok(report.results[0]!.reasons.includes('required_techniques_missing:integration,recovery,security'));
});

test('critical proof minimum diversity floor rejects six-less set even without explicit techniques', () => {
  const floorOnly: ProofRequirement = { claimId: 'floor-only', criticality: 'critical', requiredTechniques: [], requiredDefectClasses: [], minimumIndependentOracles: 2, minimumEnvironments: 2, requireObserved: false };
  const rows: ProofObservation[] = ['unit', 'contract', 'property', 'mutation', 'integration'].map((technique, index) => proof(`floor-${index}`, technique as ProofObservation['technique'], `oracle-${index}`, index % 2 === 0 ? 'local' : 'sandbox', [], { claimIds: ['floor-only'] }));
  const report = evaluateProofDiversity([floorOnly], rows);
  assert.equal(report.status, 'BLOCK'); assert.ok(report.results[0]!.reasons.includes('technique_floor:5/6'));
});

test('proof diversity requires observed evidence when the claim demands it', () => {
  const report = evaluateProofDiversity([requirement], goodProofs().map((row) => ({ ...row, observed: false })));
  assert.equal(report.status, 'BLOCK'); assert.ok(report.results[0]!.reasons.includes('observed_proof_missing'));
});

test('proof diversity detects evidence concentration across many claims', () => {
  const requirements = ['a', 'b', 'c', 'd'].map((claimId): ProofRequirement => ({ claimId, criticality: 'normal', requiredTechniques: [], requiredDefectClasses: [], minimumIndependentOracles: 1, minimumEnvironments: 1, requireObserved: false }));
  const observations = requirements.flatMap((row, index) => [proof(`shared-${index}`, 'unit', `oracle-${index}`, 'local', [], { claimIds: [row.claimId], evidenceRef: 'one-evidence' }), proof(`extra-${index}-1`, 'contract', `oracle-x-${index}`, 'local', [], { claimIds: [row.claimId] }), proof(`extra-${index}-2`, 'property', `oracle-y-${index}`, 'local', [], { claimIds: [row.claimId] })]);
  const report = evaluateProofDiversity(requirements, observations);
  assert.equal(report.status, 'BLOCK'); assert.equal(report.metrics.concentrationFindings, 1);
});

test('proof diversity is deterministic under input reordering', () => {
  const a = evaluateProofDiversity([requirement], goodProofs());
  const b = evaluateProofDiversity([requirement], [...goodProofs()].reverse());
  assert.equal(a.reportDigest, b.reportDigest); assert.deepEqual(a.results, b.results);
});

test('integration contracts require success rejection timeout replay concurrency tamper rollback and tenancy proof', () => {
  const report = evaluateIntegrationContractAssurance([contract()]);
  assert.equal(report.status, 'PASS'); assert.equal(report.metrics.closedEdges, 1); assert.ok(report.metrics.testReferences >= 8);
});

test('integration timeout and replay proof cannot be bypassed for critical edges', () => {
  const report = evaluateIntegrationContractAssurance([contract({ timeoutTestRefs: [], replayTestRefs: [] })]);
  assert.equal(report.status, 'BLOCK'); assert.deepEqual(report.results[0]!.reasons.filter((value) => value.includes('test_missing')), ['replay_test_missing', 'timeout_test_missing']);
});

test('integration owner reviewer conflicts fail closed', () => {
  const report = evaluateIntegrationContractAssurance([contract({ reviewerIds: ['owner-a', 'reviewer-c'] })]);
  assert.equal(report.status, 'BLOCK'); assert.ok(report.results[0]!.reasons.includes('owner_reviewer_conflict'));
});

test('authority cycles across integration edges are rejected', () => {
  const a = contract({ edgeId: 'a-b', sourceCapability: 'a', targetCapability: 'b' });
  const b = contract({ edgeId: 'b-a', sourceCapability: 'b', targetCapability: 'a' });
  const report = evaluateIntegrationContractAssurance([a, b]);
  assert.equal(report.status, 'BLOCK'); assert.equal(report.metrics.authorityCycles, 1); assert.ok(report.results.every((row) => row.reasons.includes('authority_cycle')));
});

test('integration fault campaign covers all critical failure classes', () => {
  const report = evaluateIntegrationFaultCampaign([contract()], goodScenarios());
  assert.equal(report.status, 'PASS'); assert.equal(report.metrics.requiredScenarios, 7); assert.equal(report.metrics.missingScenarios, 0);
});

test('integration fault disposition mismatch is rejected', () => {
  const rows = goodScenarios().map((row) => row.fault === 'timeout' ? { ...row, observedDisposition: 'COMPLETE' as const } : row);
  const report = evaluateIntegrationFaultCampaign([contract()], rows);
  assert.equal(report.status, 'BLOCK'); assert.ok(report.results[0]!.findings.includes('disposition_mismatch:scenario-timeout'));
});

test('integration fault residual side effects are rejected', () => {
  const rows = goodScenarios().map((row) => row.fault === 'tamper' ? { ...row, residualSideEffects: 1 } : row);
  const report = evaluateIntegrationFaultCampaign([contract()], rows);
  assert.equal(report.status, 'BLOCK'); assert.equal(report.metrics.unsafeSideEffects, 1);
});

test('integration fault tenant leaks are rejected', () => {
  const rows = goodScenarios().map((row) => row.fault === 'tenant-confusion' ? { ...row, tenantLeak: true } : row);
  const report = evaluateIntegrationFaultCampaign([contract()], rows);
  assert.equal(report.status, 'BLOCK'); assert.equal(report.metrics.tenantLeaks, 1);
});

test('integration fault campaign requires replay safety for duplicate and reorder', () => {
  const rows = goodScenarios().map((row) => row.fault === 'duplicate' ? { ...row, replaySafe: false } : row);
  const report = evaluateIntegrationFaultCampaign([contract()], rows);
  assert.equal(report.status, 'BLOCK'); assert.ok(report.results[0]!.findings.includes('replay_unsafe:scenario-duplicate'));
});

test('governed release assurance integrates local proofs but never promotes production', () => {
  const g = goodInputs();
  const report = evaluateGovernedReleaseAssurance({ changeImpactDecision: g.decision, changeImpactReport: g.impact, verificationPlan: g.plan, proofDiversity: g.diversity, integrationContracts: g.integration, faultCampaign: g.faults, claimClosure: g.claims, satisfiedEvidenceObligations: g.decision.evidenceObligations, rollbackVerified: true, evidenceIdentityCoherent: true, externalBlockers: ['postgres-ha', 'hsm-kms'] });
  assert.equal(report.status, 'PASS_WITH_EXTERNAL_BLOCKERS'); assert.equal(report.localDisposition, 'READY_FOR_EXTERNAL_QUALIFICATION'); assert.equal(report.productionPromotion, 'BLOCKED');
});

test('release assurance evidence identity check cannot be bypassed', () => {
  const g = goodInputs();
  const report = evaluateGovernedReleaseAssurance({ changeImpactDecision: g.decision, changeImpactReport: g.impact, verificationPlan: g.plan, proofDiversity: g.diversity, integrationContracts: g.integration, faultCampaign: g.faults, claimClosure: g.claims, satisfiedEvidenceObligations: g.decision.evidenceObligations, rollbackVerified: true, evidenceIdentityCoherent: false, externalBlockers: [] });
  assert.equal(report.status, 'BLOCK'); assert.ok(report.failures.includes('evidence_identity_incoherent'));
});

test('release assurance requires every semantic evidence obligation', () => {
  const g = goodInputs();
  const report = evaluateGovernedReleaseAssurance({ changeImpactDecision: g.decision, changeImpactReport: g.impact, verificationPlan: g.plan, proofDiversity: g.diversity, integrationContracts: g.integration, faultCampaign: g.faults, claimClosure: g.claims, satisfiedEvidenceObligations: ['test-report'], rollbackVerified: true, evidenceIdentityCoherent: true, externalBlockers: [] });
  assert.equal(report.status, 'BLOCK'); assert.ok(report.failures.some((value) => value.startsWith('evidence_obligation_unsatisfied:')));
});

test('release assurance requires verified rollback for critical change', () => {
  const g = goodInputs();
  const report = evaluateGovernedReleaseAssurance({ changeImpactDecision: g.decision, changeImpactReport: g.impact, verificationPlan: g.plan, proofDiversity: g.diversity, integrationContracts: g.integration, faultCampaign: g.faults, claimClosure: g.claims, satisfiedEvidenceObligations: g.decision.evidenceObligations, rollbackVerified: false, evidenceIdentityCoherent: true, externalBlockers: [] });
  assert.equal(report.status, 'BLOCK'); assert.ok(report.failures.includes('rollback_not_verified'));
});

test('release assurance blocks when integration fault proof is incomplete', () => {
  const g = goodInputs();
  const badFaults = evaluateIntegrationFaultCampaign([contract()], goodScenarios().filter((row) => row.fault !== 'tamper'));
  const report = evaluateGovernedReleaseAssurance({ changeImpactDecision: g.decision, changeImpactReport: g.impact, verificationPlan: g.plan, proofDiversity: g.diversity, integrationContracts: g.integration, faultCampaign: badFaults, claimClosure: g.claims, satisfiedEvidenceObligations: g.decision.evidenceObligations, rollbackVerified: true, evidenceIdentityCoherent: true, externalBlockers: [] });
  assert.equal(report.status, 'BLOCK'); assert.ok(report.failures.includes('integration_fault_campaign_blocked'));
});

test('proof and integration evaluators reject duplicate identities and unknown edges', () => {
  assert.throws(() => evaluateProofDiversity([requirement, requirement], goodProofs()), /requirement_duplicate/);
  assert.throws(() => evaluateIntegrationContractAssurance([contract(), contract()]), /edge_identity_invalid/);
  assert.throws(() => evaluateIntegrationFaultCampaign([contract()], [scenario('timeout', { edgeId: 'unknown' })]), /edge_unknown/);
});

test('integration contract edge matrix exposes every local closure obligation', () => {
  const report = evaluateIntegrationContractAssurance([contract({
    sourceCapability: 'same', targetCapability: 'same', contractVersion: 'v1', ownerIds: [], reviewerIds: ['reviewer-only'],
    successTestRefs: [], rejectionTestRefs: [], timeoutTestRefs: [], replayTestRefs: [], concurrencyTestRefs: [], tamperTestRefs: [],
    rollbackTestRefs: [], tenantIsolationTestRefs: [], observabilityRefs: [], evidenceRefs: [],
  })]);
  assert.equal(report.status, 'BLOCK');
  assert.deepEqual(report.results[0]!.reasons, [
    'authority_cycle', 'concurrency_test_missing', 'contract_version_invalid', 'evidence_missing', 'independent_reviewers_insufficient',
    'observability_missing', 'owner_missing', 'rejection_test_missing', 'replay_test_missing', 'rollback_test_missing',
    'self_integration_forbidden', 'success_test_missing', 'tamper_test_missing', 'tenant_isolation_test_missing', 'timeout_test_missing',
  ]);
});

test('normal and high integration contracts apply only their required obligations', () => {
  const normal = contract({ edgeId: 'normal', criticality: 'normal', stateful: false, crossTenant: false, authorityBearing: false, timeoutTestRefs: [], replayTestRefs: [], concurrencyTestRefs: [], tamperTestRefs: [], rollbackTestRefs: [], tenantIsolationTestRefs: [], reviewerIds: [] });
  const high = contract({ edgeId: 'high', criticality: 'high', stateful: false, crossTenant: false, authorityBearing: false, concurrencyTestRefs: [], tamperTestRefs: [], rollbackTestRefs: [], tenantIsolationTestRefs: [], reviewerIds: ['reviewer-b'] });
  const report = evaluateIntegrationContractAssurance([normal, high]);
  assert.equal(report.status, 'PASS'); assert.equal(report.metrics.closedEdges, 2); assert.equal(report.metrics.criticalEdges, 0); assert.equal(report.metrics.authorityEdges, 0);
});

test('integration contract normalization rejects empty edge and capability identities', () => {
  assert.throws(() => evaluateIntegrationContractAssurance([contract({ edgeId: ' ' })]), /edge_identity_invalid/);
  assert.throws(() => evaluateIntegrationContractAssurance([contract({ sourceCapability: ' ' })]), /capability_invalid/);
  assert.throws(() => evaluateIntegrationContractAssurance([contract({ targetCapability: ' ' })]), /capability_invalid/);
});

test('fault campaign covers normal and high obligation sets independently', () => {
  const normalContract = contract({ edgeId: 'normal-edge', criticality: 'normal', crossTenant: false });
  const highContract = contract({ edgeId: 'high-edge', criticality: 'high', crossTenant: false });
  const normalRows = [scenario('timeout', { scenarioId: 'n-timeout', edgeId: 'normal-edge' }), scenario('dependency-unavailable', { scenarioId: 'n-dep', edgeId: 'normal-edge' })];
  const highRows = ['timeout', 'duplicate', 'reorder', 'dependency-unavailable'].map((fault) => scenario(fault as IntegrationFaultScenario['fault'], { scenarioId: `h-${fault}`, edgeId: 'high-edge' }));
  const report = evaluateIntegrationFaultCampaign([normalContract, highContract], [...normalRows, ...highRows]);
  assert.equal(report.status, 'PASS'); assert.equal(report.metrics.requiredScenarios, 6); assert.equal(report.metrics.matchedScenarios, 6);
});

test('tenant confusion on a non-cross-tenant edge must still block', () => {
  const local = contract({ crossTenant: false });
  const rows = goodScenarios().map((row) => row.fault === 'tenant-confusion' ? { ...row, observedDisposition: 'COMPLETE' as const, expectedDisposition: 'COMPLETE' as const } : row);
  const report = evaluateIntegrationFaultCampaign([local], rows);
  assert.equal(report.status, 'BLOCK'); assert.ok(report.results[0]!.findings.includes('tenant_confusion_not_blocked:scenario-tenant-confusion'));
});

test('fault campaign rejects malformed and duplicate contracts and scenarios', () => {
  assert.throws(() => evaluateIntegrationFaultCampaign([contract({ edgeId: ' ' })], []), /contract_identity_invalid/);
  assert.throws(() => evaluateIntegrationFaultCampaign([contract(), contract()], []), /contract_identity_invalid/);
  assert.throws(() => evaluateIntegrationFaultCampaign([contract()], [scenario('timeout', { scenarioId: ' ' })]), /scenario_identity_invalid/);
  assert.throws(() => evaluateIntegrationFaultCampaign([contract()], [scenario('timeout'), scenario('duplicate', { scenarioId: 'scenario-timeout' })]), /scenario_identity_invalid/);
  assert.throws(() => evaluateIntegrationFaultCampaign([contract()], [scenario('timeout', { durationMs: -1 })]), /scenario_invalid/);
  assert.throws(() => evaluateIntegrationFaultCampaign([contract()], [scenario('timeout', { residualSideEffects: -1 })]), /scenario_invalid/);
  assert.throws(() => evaluateIntegrationFaultCampaign([contract()], [scenario('timeout', { evidenceRef: ' ' })]), /scenario_invalid/);
});

test('governed release assurance reports every upstream and inventory failure', () => {
  const g = goodInputs();
  const report = evaluateGovernedReleaseAssurance({
    changeImpactDecision: { ...g.decision, status: 'BLOCK', impactedFiles: [], changedNodeIds: [], rollbackRequired: false },
    changeImpactReport: { ...g.impact, status: 'BLOCK', metrics: { changes: 1 } },
    verificationPlan: { ...g.plan, status: 'BLOCK', metrics: { ...g.plan.metrics, changedFiles: 1, selectedTests: 0, impactedCapabilities: 0 }, impactedCapabilities: [] },
    proofDiversity: { ...g.diversity, status: 'BLOCK' }, integrationContracts: { ...g.integration, status: 'BLOCK' },
    faultCampaign: { ...g.faults, status: 'BLOCK' }, claimClosure: { ...g.claims, status: 'BLOCK' },
    satisfiedEvidenceObligations: [], rollbackVerified: false, evidenceIdentityCoherent: false, externalBlockers: ['  postgres  ', 'postgres', ''],
  });
  assert.equal(report.status, 'BLOCK');
  for (const reason of ['semantic_change_impact_blocked', 'change_governance_blocked', 'verification_plan_blocked', 'proof_diversity_blocked', 'integration_contracts_blocked', 'integration_fault_campaign_blocked', 'claim_closure_blocked', 'evidence_identity_incoherent', 'changed_file_inventory_mismatch', 'change_inventory_mismatch', 'impacted_capability_missing', 'selected_tests_missing']) assert.ok(report.failures.includes(reason), reason);
  assert.deepEqual(report.externalBlockers, ['postgres']);
});

test('proof normalization and empty proof paths fail closed', () => {
  assert.throws(() => evaluateProofDiversity([{ ...requirement, claimId: ' ' }], []), /requirement_identity_invalid/);
  assert.throws(() => evaluateProofDiversity([{ ...requirement, minimumIndependentOracles: 0 }], []), /oracle_floor_invalid/);
  assert.throws(() => evaluateProofDiversity([{ ...requirement, minimumEnvironments: 0 }], []), /environment_floor_invalid/);
  assert.throws(() => evaluateProofDiversity([requirement], [proof(' ', 'unit', 'oracle', 'env', [])]), /observation_identity_invalid/);
  assert.throws(() => evaluateProofDiversity([requirement], [proof('x', 'unit', ' ', 'env', [])]), /observation_identity_invalid/);
  assert.throws(() => evaluateProofDiversity([requirement], [proof('x', 'unit', 'oracle', ' ', [])]), /observation_identity_invalid/);
  assert.throws(() => evaluateProofDiversity([requirement], [proof('x', 'unit', 'oracle', 'env', [], { claimIds: [] })]), /claims_required/);
  const empty = evaluateProofDiversity([requirement], []);
  assert.equal(empty.status, 'BLOCK'); assert.ok(empty.results[0]!.reasons.includes('proof_missing'));
  const unknown = evaluateProofDiversity([requirement], [proof('unknown', 'unit', 'oracle', 'env', [], { claimIds: ['other'] })]);
  assert.ok(unknown.findings.includes('proof_claim_unknown:unknown:other'));
});
