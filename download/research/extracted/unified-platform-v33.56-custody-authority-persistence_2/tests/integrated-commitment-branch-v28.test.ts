import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runIntegratedEngineeringCommitment } from '../src/app/integrated-engineering-commitment.js';
import type { DomainPackManifest, RequirementContract } from '../src/contracts/system.js';
import { generateSigningIdentity, sha256, signEnvelope } from '../src/contracts/crypto.js';
import type { AuthorityGrant } from '../src/contracts/canonical.js';
import type { GeneratedDomainPack } from '../src/platform/domain-pack-generator.js';
import { DigitalThread } from '../src/platform/digital-thread.js';
import type { DurableRuntimeEngine } from '../src/runtime/engine.js';
import { createHarness } from './helpers.js';

const manifest: DomainPackManifest = {
  packId: 'branch-pack', version: '1.0.0', kernelContractVersion: '0.2.0', ontologyVersion: '1.0.0',
  workflows: ['inventory'], requiredCapabilities: ['repository.inventory'], emittedEvidenceClasses: ['COMPUTED'],
  requiredScopes: ['repository.read'], uiSurfaces: ['evidence-viewer'], risks: ['source-exposure'], authorityModel: 'canonical-kernel-only',
};
const packMaterial = {
  generationId: 'generation-branch-pack', status: 'APPROVED_FOR_REGISTRATION' as const, manifest,
  ontology: { entities: ['repository'], relationships: ['inventory:operates-on:repository'], version: '1.0.0' },
  requirementTemplates: [], uiSchema: [{ surfaceId: 'evidence-viewer', purpose: 'test', authoritative: false as const }],
  testSkeleton: [], riskRegister: [{ riskId: 'risk-1', statement: 'source-exposure', mitigation: 'review' }],
  uncertainties: ['fixture'], sourceRefs: ['fixture'], approvedBy: ['domain-reviewer-a', 'domain-reviewer-b'],
};
const pack: GeneratedDomainPack = { ...packMaterial, digest: sha256(packMaterial) };
const requirement: RequirementContract = {
  requirementId: 'req-branch', tenantId: 'tenant-1', statement: 'Inventory is produced.', criticality: 'HIGH',
  requiredEvidenceClasses: ['COMPUTED'], verificationModes: ['TEST'], acceptanceCriteria: {}, version: '1.0.0',
};
const signer = generateSigningIdentity('integrated-v28-signer');
const grant: AuthorityGrant = { grantId: 'grant', tenantId: 'tenant-1', subjectId: 'subject-1', scopes: ['repository.read'], issuedAt: '2026-07-17T00:00:00.000Z', expiresAt: '2026-07-18T00:00:00.000Z', issuer: 'test' };
const signedGrant = signEnvelope(grant, signer);
const lease = { missionId: 'm', workerId: 'worker', fenceToken: 1, expiresAt: Date.now() + 60_000 };
const outbox = { outboxId: 'o', missionId: 'm', tenantId: 'tenant-1', effectKey: 'e', payload: {}, status: 'PENDING', attemptCount: 0, fenceToken: 1, createdAt: new Date().toISOString(), deliveredAt: null };
const mission = { missionId: 'm', revision: 1 };
const base = { signedGrant, repositoryRoot: '/repo', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder', reviewerId: 'reviewer', workerId: 'worker', passportSigner: signer, domainPack: pack, requirements: [requirement] };

test('integrated commitment requires at least one requirement before creating a mission', async () => {
  const engine = {} as DurableRuntimeEngine;
  await assert.rejects(runIntegratedEngineeringCommitment({ ...base, engine, requirements: [] }), /requirement_required/);
});

test('integrated commitment enforces approval and outbox boundaries', async () => {
  const bypass = {
    createAuthorizedMission() {}, acquire() { return lease; }, prepare() { return outbox; },
  } as unknown as DurableRuntimeEngine;
  await assert.rejects(runIntegratedEngineeringCommitment({ ...base, engine: bypass }), /approval_gate_not_enforced/);

  let calls = 0;
  const missing = {
    createAuthorizedMission() {}, acquire() { return lease; }, prepare() { calls += 1; return null; }, approve() {},
    store: { getMission() { return mission; } },
  } as unknown as DurableRuntimeEngine;
  await assert.rejects(runIntegratedEngineeringCommitment({ ...base, engine: missing }), /approved_mission_missing_outbox/);
  assert.equal(calls, 2);
});

test('integrated commitment rejects unsupported execution payloads', async () => {
  let calls = 0;
  const engine = {
    createAuthorizedMission() {}, acquire() { return lease; }, prepare() { calls += 1; return calls === 1 ? null : outbox; }, approve() {},
    async execute(_outbox: unknown, _lease: unknown, executor: (payload: Record<string, unknown>) => Promise<unknown>) { return { result: await executor({ capability: 'network.write' }) }; },
    store: { getMission() { return mission; } },
  } as unknown as DurableRuntimeEngine;
  await assert.rejects(runIntegratedEngineeringCommitment({ ...base, engine }), /unsupported_capability_payload/);
});

test('integrated commitment supports criteria without minimumFiles and empty observed failures', async () => {
  const h = createHarness(new Date());
  try {
    const repository = join(h.directory, 'repo-branch'); mkdirSync(repository); writeFileSync(join(repository, 'a.txt'), 'alpha');
    const result = await runIntegratedEngineeringCommitment({
      engine: h.engine, signedGrant: h.signedGrant, repositoryRoot: repository, tenantId: 'tenant-1', subjectId: 'subject-1',
      builderId: 'builder-1', reviewerId: 'reviewer-1', workerId: 'worker-1', passportSigner: h.reviewer,
      domainPack: pack, requirements: [requirement],
    });
    assert.equal(result.certification.decision, 'PASS');
    assert.deepEqual(result.failureKnowledge, []);
  } finally { h.store.close(); }
});

test('integrated commitment fails closed when the generated digital thread does not verify', async () => {
  const h = createHarness();
  const original = DigitalThread.prototype.verify;
  DigitalThread.prototype.verify = function () { return { ok: false, root: '0'.repeat(64), nodeCount: 0, edgeCount: 0 }; };
  try {
    const repository = join(h.directory, 'repo-thread'); mkdirSync(repository); writeFileSync(join(repository, 'a.txt'), 'alpha');
    await assert.rejects(runIntegratedEngineeringCommitment({
      engine: h.engine, signedGrant: h.signedGrant, repositoryRoot: repository, tenantId: 'tenant-1', subjectId: 'subject-1',
      builderId: 'builder-1', reviewerId: 'reviewer-1', workerId: 'worker-1', passportSigner: h.reviewer,
      domainPack: pack, requirements: [requirement], now: h.now,
    }), /digital_thread_invalid/);
  } finally {
    DigitalThread.prototype.verify = original;
    h.store.close();
  }
});
