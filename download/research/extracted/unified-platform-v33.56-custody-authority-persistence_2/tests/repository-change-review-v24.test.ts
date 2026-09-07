import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { approveChangeSession, executeChangePlan, loadChangeSession } from '../src/repository/change-assurance.js';
import { KeyLifecycleRegistry } from '../src/security/key-lifecycle.js';
import { passportRegistry, setupRepositoryChange } from './repository-change-fixture-v24.js';

const now = new Date('2026-07-16T12:00:00.000Z');

test('independent reviewer issues a purpose-bound shadow passport', async () => {
  const { sessions, plan } = setupRepositoryChange();
  const state = await executeChangePlan(plan, { sessionsRoot: sessions });
  const { signer, registry } = passportRegistry(now);
  assert.throws(() => approveChangeSession({ sessionsRoot: sessions, sessionId: state.sessionId, reviewerId: 'builder-1', passportSigner: signer, keyRegistry: registry, now }), /self_approval/);
  const approved = approveChangeSession({ sessionsRoot: sessions, sessionId: state.sessionId, reviewerId: 'reviewer-1', passportSigner: signer, keyRegistry: registry, now });
  assert.equal(approved.status, 'APPROVED_SHADOW');
  assert.ok(approved.passport);
  assert.equal(registry.verify(approved.passport, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), true);
});

test('revoked passport key prevents verification after approval', async () => {
  const { sessions, plan } = setupRepositoryChange();
  const state = await executeChangePlan(plan, { sessionsRoot: sessions });
  const { signer, registry } = passportRegistry(now);
  const approved = approveChangeSession({ sessionsRoot: sessions, sessionId: state.sessionId, reviewerId: 'reviewer-1', passportSigner: signer, keyRegistry: registry, now });
  registry.revoke(signer.keyId, { status: 'REVOKED', reason: 'test revocation', effectiveAt: now, approvedBy: ['security-1'] });
  assert.ok(approved.passport);
  assert.equal(registry.verify(approved.passport, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), false);
  assert.equal(loadChangeSession(sessions, state.sessionId).status, 'APPROVED_SHADOW');
});

test('passport remains independently verifiable from the persisted trust snapshot', async () => {
  const { sessions, plan } = setupRepositoryChange();
  const state = await executeChangePlan(plan, { sessionsRoot: sessions });
  const { signer, registry } = passportRegistry(now);
  const approved = approveChangeSession({ sessionsRoot: sessions, sessionId: state.sessionId, reviewerId: 'reviewer-offline', passportSigner: signer, keyRegistry: registry, now });
  assert.ok(approved.passport);
  assert.ok(approved.trustSnapshot);
  const offlineRegistry = KeyLifecycleRegistry.fromSnapshot(approved.trustSnapshot);
  assert.equal(offlineRegistry.verify(approved.passport, { purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1' }, now), true);
  assert.equal(existsSync(join(approved.artifactDirectory, 'trust-snapshot.json')), true);
});
