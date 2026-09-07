import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, signEnvelope } from '../src/contracts/crypto.js';
import type { AuthorityGrant } from '../src/contracts/canonical.js';
import { runRepositoryShadowCommitment } from '../src/app/shadow-commitment.js';
import type { DurableRuntimeEngine } from '../src/runtime/engine.js';

const signer = generateSigningIdentity('shadow-v28-signer');
const grant: AuthorityGrant = {
  grantId: 'g', tenantId: 'tenant-1', subjectId: 'subject-1', scopes: ['repository.read'],
  issuedAt: '2026-07-17T00:00:00.000Z', expiresAt: '2026-07-18T00:00:00.000Z', issuer: 'test',
};
const signedGrant = signEnvelope(grant, signer);
const lease = { missionId: 'm', workerId: 'worker', fenceToken: 1, expiresAt: Date.now() + 60_000 };
const outbox = { outboxId: 'o', missionId: 'm', tenantId: 'tenant-1', effectKey: 'e', payload: {}, status: 'PENDING', attemptCount: 0, fenceToken: 1, createdAt: new Date().toISOString(), deliveredAt: null };
const mission = { missionId: 'm', revision: 1 };
const inventory = { root: '/repo', fileCount: 0, totalBytes: 0, files: [], treeDigest: 'a'.repeat(64) };
const base = { signedGrant, repositoryRoot: '/repo', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder', reviewerId: 'reviewer', workerId: 'worker', passportSigner: signer };

test('shadow orchestration rejects a first prepare that bypasses approval', async () => {
  const engine = {
    createAuthorizedMission() {}, acquire() { return lease; }, prepare() { return outbox; },
    store: { getMission() { return mission; } },
  } as unknown as DurableRuntimeEngine;
  await assert.rejects(runRepositoryShadowCommitment({ ...base, engine }), /approval_gate_not_enforced/);
});

test('shadow orchestration rejects a missing outbox after approval', async () => {
  let calls = 0;
  const engine = {
    createAuthorizedMission() {}, acquire() { return lease; }, prepare() { calls += 1; return null; }, approve() {},
    store: { getMission() { return mission; } },
  } as unknown as DurableRuntimeEngine;
  await assert.rejects(runRepositoryShadowCommitment({ ...base, engine }), /approved_mission_missing_outbox/);
  assert.equal(calls, 2);
});

test('shadow orchestration rejects unsupported capability payload before repository access', async () => {
  let calls = 0;
  const engine = {
    createAuthorizedMission() {}, acquire() { return lease; }, prepare() { calls += 1; return calls === 1 ? null : outbox; }, approve() {},
    async execute(_outbox: unknown, _lease: unknown, executor: (payload: Record<string, unknown>) => Promise<unknown>) { return { result: await executor({ capability: 'network.write' }) }; },
    store: { getMission() { return mission; } },
  } as unknown as DurableRuntimeEngine;
  await assert.rejects(runRepositoryShadowCommitment({ ...base, engine }), /unsupported_capability_payload/);
});

test('shadow orchestration rejects invalid and mismatched evidence-chain roots', async () => {
  let calls = 0;
  const invalidEngine = {
    createAuthorizedMission() {}, acquire() { return lease; }, prepare() { calls += 1; return calls === 1 ? null : outbox; }, approve() {},
    async execute() { return { result: inventory }; }, appendEvidence() { return 'root'; },
    store: { getMission() { return mission; }, verifyEvidenceChain() { return { ok: false, count: 1, root: null }; } },
  } as unknown as DurableRuntimeEngine;
  await assert.rejects(runRepositoryShadowCommitment({ ...base, engine: invalidEngine }), /evidence_chain_invalid/);

  calls = 0;
  const mismatchEngine = {
    createAuthorizedMission() {}, acquire() { return lease; }, prepare() { calls += 1; return calls === 1 ? null : outbox; }, approve() {},
    async execute() { return { result: inventory }; }, appendEvidence() { return 'root'; },
    store: { getMission() { return mission; }, verifyEvidenceChain() { return { ok: true, count: 1, root: 'other' }; } },
  } as unknown as DurableRuntimeEngine;
  await assert.rejects(runRepositoryShadowCommitment({ ...base, engine: mismatchEngine }), /evidence_chain_invalid/);
});
