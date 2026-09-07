import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateDomainPackManifest,
  validateEngineeringCommitment,
  validateRequirement,
  type DomainPackManifest,
  type EngineeringCommitment,
  type RequirementContract,
} from '../src/contracts/system.js';

const now = new Date('2026-07-16T12:00:00.000Z');

function requirement(overrides: Partial<RequirementContract> = {}): RequirementContract {
  return {
    requirementId: 'req-1', tenantId: 'tenant-1', statement: 'Inventory at least one file.',
    criticality: 'HIGH', requiredEvidenceClasses: ['COMPUTED'], verificationModes: ['TEST'],
    acceptanceCriteria: { minimumFiles: 1 }, version: '1.0.0', ...overrides,
  };
}

function commitment(overrides: Partial<EngineeringCommitment> = {}): EngineeringCommitment {
  return {
    commitmentId: 'commitment-1', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1',
    domainPackId: 'software-delivery', goal: 'Verify repository inventory.', authorityGrantDigest: 'a'.repeat(64),
    requirementIds: ['req-1'], promotionCeiling: 'shadow', createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(), ...overrides,
  };
}

function pack(overrides: Partial<DomainPackManifest> = {}): DomainPackManifest {
  return {
    packId: 'software-delivery', version: '1.0.0', kernelContractVersion: '0.2.0', ontologyVersion: '1.0.0',
    workflows: ['repository-inventory'], requiredCapabilities: ['repository.inventory'], emittedEvidenceClasses: ['COMPUTED'],
    requiredScopes: ['repository.read'], uiSurfaces: ['evidence-viewer'], risks: ['source-code-exposure'],
    authorityModel: 'canonical-kernel-only', ...overrides,
  };
}

test('requirement contract accepts explicit evidence and verification modes', () => {
  assert.doesNotThrow(() => validateRequirement(requirement()));
});

test('requirement contract rejects duplicate evidence classes and missing verification modes', () => {
  assert.throws(() => validateRequirement(requirement({ requiredEvidenceClasses: ['COMPUTED', 'COMPUTED'] })), /duplicate_required_evidence_class/);
  assert.throws(() => validateRequirement(requirement({ verificationModes: [] })), /verification_mode_required/);
});

test('engineering commitment is tenant-bound, expiring and shadow-capped', () => {
  assert.doesNotThrow(() => validateEngineeringCommitment(commitment(), now));
  assert.throws(() => validateEngineeringCommitment(commitment({ promotionCeiling: 'production' as 'shadow' }), now), /invalid_promotion_ceiling/);
  assert.throws(() => validateEngineeringCommitment(commitment({ expiresAt: now.toISOString() }), now), /invalid_commitment_expiry|commitment_expired/);
});

test('domain pack cannot own kernel authority or wildcard scopes', () => {
  assert.doesNotThrow(() => validateDomainPackManifest(pack()));
  assert.throws(() => validateDomainPackManifest(pack({ authorityModel: 'pack-owned' as 'canonical-kernel-only' })), /domain_pack_authority_forbidden/);
  assert.throws(() => validateDomainPackManifest(pack({ requiredScopes: ['repository.*'] })), /domain_pack_wildcard_scope_forbidden/);
  assert.throws(() => validateDomainPackManifest(pack({ requiredScopes: ['authority.grant'] })), /domain_pack_kernel_scope_forbidden/);
});
