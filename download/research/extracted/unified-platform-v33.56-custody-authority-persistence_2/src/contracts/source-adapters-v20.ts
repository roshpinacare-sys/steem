import { sha256 } from './crypto.js';
import type { CertificationResult, RequirementContract } from './system.js';
import type { EvidenceRecord } from './canonical.js';

export interface YongzuanRequirementFixture {
  readonly id: string;
  readonly tenantId: string;
  readonly description: string;
  readonly metric: string;
  readonly unit: string;
  readonly operator: '<=' | '>=' | '==' | 'between';
  readonly target: number | readonly [number, number];
  readonly critical: boolean;
  readonly version?: string;
}

export interface YongzuanCertificationFixture {
  readonly certificationId: string;
  readonly tenantId: string;
  readonly commitmentId: string;
  readonly requirementResults: readonly { readonly requirementId: string; readonly passed: boolean; readonly evidenceClass: 'SIMULATED' | 'COMPUTED' | 'MEASURED'; readonly evidenceDigest: string }[];
  readonly status: 'SIMULATION_PASS' | 'PHYSICAL_PASS' | 'FAIL' | 'INCONCLUSIVE';
  readonly limitations: readonly string[];
  readonly issuedAt: string;
  readonly reviewerIds: readonly string[];
}

export interface QodoDeliveryReceiptFixture {
  readonly receiptId: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly planDigest: string;
  readonly changeDigest: string;
  readonly tests: readonly { readonly id: string; readonly passed: boolean; readonly evidenceDigest: string }[];
  readonly budget: { readonly operations: number; readonly maxOperations: number };
  readonly circuitBreaker: 'CLOSED' | 'OPEN';
  readonly createdAt: string;
}

export function yongzuanRequirementToCanonical(input: YongzuanRequirementFixture): RequirementContract {
  if (input.id.trim() === '' || input.description.trim() === '' || input.metric.trim() === '' || input.unit.trim() === '') throw new Error('invalid_yongzuan_requirement');
  return {
    requirementId: input.id,
    tenantId: input.tenantId,
    statement: input.description,
    criticality: input.critical ? 'SAFETY_CRITICAL' : 'MEDIUM',
    requiredEvidenceClasses: ['SIMULATED', 'COMPUTED', 'MEASURED'],
    verificationModes: ['SIMULATION', 'TEST', 'MEASUREMENT'],
    acceptanceCriteria: { metric: input.metric, unit: input.unit, operator: input.operator, target: input.target },
    version: input.version ?? '1.0.0',
  };
}

export function yongzuanCertificationToCanonical(input: YongzuanCertificationFixture): CertificationResult {
  if (!Number.isFinite(Date.parse(input.issuedAt))) throw new Error('invalid_yongzuan_certification_time');
  if (input.status === 'PHYSICAL_PASS' && input.requirementResults.some((result) => result.evidenceClass !== 'MEASURED')) throw new Error('physical_certification_requires_measured_evidence');
  if (input.reviewerIds.length === 0) throw new Error('yongzuan_reviewer_required');
  const requirementResults = input.requirementResults.map((result) => ({
    requirementId: result.requirementId,
    status: result.passed ? 'PASS' as const : 'FAIL' as const,
    evidenceRecordIds: [result.evidenceDigest],
    explanation: `${result.evidenceClass.toLowerCase()} evidence imported through bounded Yongzuan adapter`,
  }));
  const decision = input.status === 'PHYSICAL_PASS' ? 'PASS' : input.status === 'SIMULATION_PASS' ? 'SIMULATION_PASS' : input.status;
  return {
    certificationId: input.certificationId,
    tenantId: input.tenantId,
    commitmentId: input.commitmentId,
    decision,
    requirementResults,
    evidenceRoot: sha256({ requirementResults, sourceStatus: input.status }),
    reviewerIds: input.reviewerIds,
    createdAt: input.issuedAt,
    limitations: input.limitations,
  };
}

export function qodoReceiptToEvidence(input: QodoDeliveryReceiptFixture): EvidenceRecord {
  if (input.circuitBreaker !== 'CLOSED') throw new Error('qodo_circuit_breaker_open');
  if (input.budget.operations > input.budget.maxOperations) throw new Error('qodo_budget_exceeded');
  if (input.tests.length === 0 || input.tests.some((test) => !test.passed)) throw new Error('qodo_tests_not_passing');
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error('invalid_qodo_receipt_time');
  return {
    recordId: input.receiptId,
    tenantId: input.tenantId,
    kind: 'software-delivery-receipt',
    subject: input.repositoryId,
    evidenceClass: 'ATTESTED',
    method: 'qodo-adapter-v20',
    environment: { adapter: 'qodo-fixture', authority: 'canonical-kernel' },
    createdAt: input.createdAt,
    payload: {
      planDigest: input.planDigest,
      changeDigest: input.changeDigest,
      testEvidenceRoot: sha256(input.tests),
      budget: input.budget,
    },
    limitations: ['adapter-fixture-not-live-qodo-integration', 'attestation-does-not-prove-test-correctness'],
  };
}
