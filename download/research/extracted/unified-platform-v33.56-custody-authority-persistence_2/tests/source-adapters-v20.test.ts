import assert from 'node:assert/strict';
import test from 'node:test';
import { qodoReceiptToEvidence, yongzuanCertificationToCanonical, yongzuanRequirementToCanonical } from '../src/contracts/source-adapters-v20.js';

const digest = 'a'.repeat(64);

test('Yongzuan requirement maps into an authority-free canonical requirement', () => {
  const requirement = yongzuanRequirementToCanonical({ id: 'REQ-1', tenantId: 'tenant-1', description: 'Maximum latency', metric: 'latency', unit: 'ms', operator: '<=', target: 100, critical: true });
  assert.equal(requirement.requirementId, 'REQ-1');
  assert.equal(requirement.criticality, 'SAFETY_CRITICAL');
});

test('Yongzuan physical certification requires measured evidence', () => {
  const base = { certificationId: 'CERT-1', tenantId: 'tenant-1', commitmentId: 'COM-1', limitations: [], issuedAt: '2026-07-17T00:00:00Z', reviewerIds: ['reviewer-1'] } as const;
  assert.throws(() => yongzuanCertificationToCanonical({ ...base, status: 'PHYSICAL_PASS', requirementResults: [{ requirementId: 'REQ-1', passed: true, evidenceClass: 'SIMULATED', evidenceDigest: digest }] }), /requires_measured/);
  const result = yongzuanCertificationToCanonical({ ...base, status: 'SIMULATION_PASS', requirementResults: [{ requirementId: 'REQ-1', passed: true, evidenceClass: 'SIMULATED', evidenceDigest: digest }] });
  assert.equal(result.decision, 'SIMULATION_PASS');
});

test('Qodo receipt maps to attested evidence only when tests, budget and circuit breaker pass', () => {
  const input = {
    receiptId: 'receipt-1', tenantId: 'tenant-1', repositoryId: 'repo-1', planDigest: digest, changeDigest: 'b'.repeat(64),
    tests: [{ id: 'test-1', passed: true, evidenceDigest: 'c'.repeat(64) }], budget: { operations: 1, maxOperations: 2 },
    circuitBreaker: 'CLOSED' as const, createdAt: '2026-07-17T00:00:00Z',
  };
  const evidence = qodoReceiptToEvidence(input);
  assert.equal(evidence.evidenceClass, 'ATTESTED');
  assert.throws(() => qodoReceiptToEvidence({ ...input, circuitBreaker: 'OPEN' }), /circuit_breaker_open/);
  assert.throws(() => qodoReceiptToEvidence({ ...input, budget: { operations: 3, maxOperations: 2 } }), /budget_exceeded/);
  assert.throws(() => qodoReceiptToEvidence({ ...input, tests: [{ ...input.tests[0]!, passed: false }] }), /tests_not_passing/);
});
