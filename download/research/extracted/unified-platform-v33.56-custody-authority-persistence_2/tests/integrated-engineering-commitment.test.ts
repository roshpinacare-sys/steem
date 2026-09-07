import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runIntegratedEngineeringCommitment } from '../src/app/integrated-engineering-commitment.js';
import type { DomainPackManifest, RequirementContract } from '../src/contracts/system.js';
import type { GeneratedDomainPack } from '../src/platform/domain-pack-generator.js';
import { sha256 } from '../src/contracts/crypto.js';
import { createHarness } from './helpers.js';

const manifest: DomainPackManifest = {
  packId: 'software-delivery', version: '1.0.0', kernelContractVersion: '0.2.0', ontologyVersion: '1.0.0',
  workflows: ['repository-inventory'], requiredCapabilities: ['repository.inventory'], emittedEvidenceClasses: ['COMPUTED'],
  requiredScopes: ['repository.read'], uiSurfaces: ['evidence-viewer', 'approval-center'], risks: ['source-code-exposure'],
  authorityModel: 'canonical-kernel-only',
};

function approvedPack(input: DomainPackManifest): GeneratedDomainPack {
  const material = {
    generationId: `generation-${input.packId}-${input.version}`,
    status: 'APPROVED_FOR_REGISTRATION' as const,
    manifest: structuredClone(input),
    ontology: { entities: ['repository'], relationships: ['inventory:operates-on:repository'], version: input.ontologyVersion },
    requirementTemplates: [], uiSchema: input.uiSurfaces.map((surfaceId) => ({ surfaceId, purpose: 'test', authoritative: false as const })),
    testSkeleton: [], riskRegister: input.risks.map((statement, index) => ({ riskId: `risk-${index}`, statement, mitigation: 'independent review' })),
    uncertainties: ['test-fixture'], sourceRefs: ['test-fixture'], approvedBy: ['domain-reviewer-1', 'domain-reviewer-2'],
  };
  return { ...material, digest: sha256(material) };
}
const pack = approvedPack(manifest);

function requirement(minimumFiles: number, evidence: RequirementContract['requiredEvidenceClasses'] = ['COMPUTED']): RequirementContract {
  return {
    requirementId: `req-${minimumFiles}-${evidence.join('-')}`, tenantId: 'tenant-1', statement: `Repository contains at least ${minimumFiles} file(s).`,
    criticality: 'HIGH', requiredEvidenceClasses: evidence, verificationModes: ['TEST'], acceptanceCriteria: { minimumFiles }, version: '1.0.0',
  };
}

test('integrated commitment links authority, requirements, mission, evidence, certification, passport and standards adapters', async () => {
  const h = createHarness();
  try {
    const repository = join(h.directory, 'repo-integrated');
    mkdirSync(repository);
    writeFileSync(join(repository, 'a.txt'), 'alpha');
    const result = await runIntegratedEngineeringCommitment({
      engine: h.engine, signedGrant: h.signedGrant, repositoryRoot: repository, tenantId: 'tenant-1', subjectId: 'subject-1',
      builderId: 'builder-1', reviewerId: 'reviewer-1', workerId: 'worker-1', passportSigner: h.reviewer,
      domainPack: pack, requirements: [requirement(1)], observedFailures: [{
        failureId: 'known-failure', tenantId: 'tenant-1', category: 'IMPORT_SIDE_EFFECT', sourceSystem: 'yongzuan',
        subject: 'p7-driver', evidenceRefs: ['evidence:yongzuan-import'], observedAt: h.now.toISOString(), severity: 'HIGH',
      }], now: h.now,
    });
    assert.equal(result.certification.decision, 'PASS');
    assert.equal(result.decision.toState, 'shadow');
    assert.equal(h.registry.verify(result.passport), true);
    assert.match(result.digitalThreadRoot, /^[a-f0-9]{64}$/);
    assert.equal(result.openLineage.eventType, 'COMPLETE');
    assert.equal(result.provenance.predicateType, 'https://slsa.dev/provenance/v1');
    assert.equal(result.failureKnowledge[0]?.automatic, true);
  } finally { h.store.close(); }
});

test('integrated commitment fails when acceptance criteria fail', async () => {
  const h = createHarness();
  try {
    const repository = join(h.directory, 'repo-empty');
    mkdirSync(repository);
    await assert.rejects(runIntegratedEngineeringCommitment({
      engine: h.engine, signedGrant: h.signedGrant, repositoryRoot: repository, tenantId: 'tenant-1', subjectId: 'subject-1',
      builderId: 'builder-1', reviewerId: 'reviewer-1', workerId: 'worker-1', passportSigner: h.reviewer,
      domainPack: pack, requirements: [requirement(1)], now: h.now,
    }), /certification_fail/);
  } finally { h.store.close(); }
});

test('integrated commitment is inconclusive when evidence class is insufficient', async () => {
  const h = createHarness();
  try {
    const repository = join(h.directory, 'repo-measured');
    mkdirSync(repository);
    writeFileSync(join(repository, 'a.txt'), 'alpha');
    await assert.rejects(runIntegratedEngineeringCommitment({
      engine: h.engine, signedGrant: h.signedGrant, repositoryRoot: repository, tenantId: 'tenant-1', subjectId: 'subject-1',
      builderId: 'builder-1', reviewerId: 'reviewer-1', workerId: 'worker-1', passportSigner: h.reviewer,
      domainPack: pack, requirements: [requirement(1, ['MEASURED'])], now: h.now,
    }), /certification_inconclusive/);
  } finally { h.store.close(); }
});

test('integrated commitment rejects cross-tenant requirements and kernel-owned pack scopes', async () => {
  const h = createHarness();
  try {
    await assert.rejects(runIntegratedEngineeringCommitment({
      engine: h.engine, signedGrant: h.signedGrant, repositoryRoot: h.directory, tenantId: 'tenant-1', subjectId: 'subject-1',
      builderId: 'builder-1', reviewerId: 'reviewer-1', workerId: 'worker-1', passportSigner: h.reviewer,
      domainPack: pack, requirements: [{ ...requirement(1), tenantId: 'tenant-2' }], now: h.now,
    }), /cross_tenant_requirement/);
    await assert.rejects(runIntegratedEngineeringCommitment({
      engine: h.engine, signedGrant: h.signedGrant, repositoryRoot: h.directory, tenantId: 'tenant-1', subjectId: 'subject-1',
      builderId: 'builder-1', reviewerId: 'reviewer-1', workerId: 'worker-1', passportSigner: h.reviewer,
      domainPack: approvedPack({ ...manifest, requiredScopes: ['authority.grant'] }), requirements: [requirement(1)], now: h.now,
    }), /domain_pack_kernel_scope_forbidden/);
  } finally { h.store.close(); }
});
