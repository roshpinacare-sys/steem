import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/contracts/crypto.js';
import { capabilityRef, PersistentCapabilityTrustStore, type TrustViolation } from '../src/platform/capability-trust.js';

const now = new Date('2026-07-17T11:00:00.000Z');
function root(): string { return mkdtempSync(join(tmpdir(), 'cap-trust-v21-')); }
function registered(store: PersistentCapabilityTrustStore, tenantId = 'tenant-1') {
  return store.register({ tenantId, capabilityId: 'repository-analyzer', version: '1.0.0', publisherId: 'publisher-1', originalScopes: ['repository.read', 'repository.inspect', 'evidence.emit', 'repository.write'] }, now);
}
function violation(index: number, severity: TrustViolation['severity'] = 'LOW', kind: TrustViolation['kind'] = 'POLICY'): TrustViolation {
  return { violationId: `violation-${index}`, kind, severity, evidenceRef: `evidence-${index}`, observedAt: new Date(now.getTime() + index).toISOString(), message: `violation ${index}` };
}

test('new capability is trusted with declared scopes and survives restart', () => {
  const directory = root();
  const store = new PersistentCapabilityTrustStore(directory);
  const state = registered(store);
  assert.equal(state.status, 'TRUSTED');
  assert.deepEqual(state.allowedScopes, ['evidence.emit', 'repository.inspect', 'repository.read', 'repository.write']);
  const reopened = new PersistentCapabilityTrustStore(directory);
  assert.equal(reopened.get('tenant-1', capabilityRef('repository-analyzer', '1.0.0')).status, 'TRUSTED');
  assert.equal(reopened.verify().ok, true);
});

test('three low violations reduce scope without arbitrary trust scores', () => {
  const store = new PersistentCapabilityTrustStore(root());
  const state = registered(store);
  const ref = capabilityRef(state.capabilityId, state.version);
  store.recordViolation('tenant-1', ref, violation(1));
  store.recordViolation('tenant-1', ref, violation(2));
  const restricted = store.recordViolation('tenant-1', ref, violation(3));
  assert.equal(restricted.status, 'RESTRICTED');
  assert.deepEqual(restricted.allowedScopes, ['evidence.emit', 'repository.inspect', 'repository.read']);
});

test('high violation quarantines and critical violation revokes', () => {
  const store = new PersistentCapabilityTrustStore(root());
  const state = registered(store);
  const ref = capabilityRef(state.capabilityId, state.version);
  const quarantined = store.recordViolation('tenant-1', ref, violation(1, 'HIGH', 'RESOURCE_ABUSE'));
  assert.equal(quarantined.status, 'QUARANTINED');
  assert.deepEqual(quarantined.allowedScopes, []);
  const revoked = store.recordViolation('tenant-1', ref, violation(2, 'CRITICAL', 'INVALID_OUTPUT'));
  assert.equal(revoked.status, 'REVOKED');
  assert.throws(() => store.recordViolation('tenant-1', ref, violation(3)), /already_revoked/);
});

test('evidence tampering and tenant leakage are critical regardless of supplied severity', () => {
  for (const kind of ['EVIDENCE_TAMPERING', 'TENANT_LEAK'] as const) {
    const store = new PersistentCapabilityTrustStore(root());
    const state = registered(store);
    const final = store.recordViolation('tenant-1', capabilityRef(state.capabilityId, state.version), violation(1, 'LOW', kind));
    assert.equal(final.status, 'REVOKED');
  }
});

test('appeal and override require dual independent control, then recertification restores bounded scopes', () => {
  const directory = root();
  const store = new PersistentCapabilityTrustStore(directory);
  const state = registered(store);
  const ref = capabilityRef(state.capabilityId, state.version);
  store.recordViolation('tenant-1', ref, violation(1, 'HIGH'));
  store.openAppeal('tenant-1', ref, { requestedBy: 'operator-1', reason: 'corrective patch available', evidenceRefs: ['patch-1'] });
  assert.throws(() => store.approveOverride('tenant-1', ref, { reviewers: ['reviewer-1'], reason: 'reviewed' }), /dual_control/);
  const awaiting = store.approveOverride('tenant-1', ref, { reviewers: ['reviewer-1', 'reviewer-2', 'publisher-1'], reason: 'independent evidence accepted' });
  assert.equal(awaiting.status, 'REQUALIFICATION_REQUIRED');
  const recertified = store.recertify('tenant-1', ref, { evidenceRoot: sha256('recertification'), reviewers: ['reviewer-1', 'reviewer-2'], restoredScopes: ['repository.read', 'evidence.emit'] });
  assert.equal(recertified.status, 'TRUSTED');
  assert.deepEqual(recertified.allowedScopes, ['evidence.emit', 'repository.read']);
  assert.equal(new PersistentCapabilityTrustStore(directory).get('tenant-1', ref).lastEvidenceRoot, sha256('recertification'));
});

test('recertification cannot escalate scope or restore a revoked version', () => {
  const store = new PersistentCapabilityTrustStore(root());
  const state = registered(store);
  const ref = capabilityRef(state.capabilityId, state.version);
  store.recordViolation('tenant-1', ref, violation(1, 'HIGH'));
  assert.throws(() => store.recertify('tenant-1', ref, { evidenceRoot: sha256('e'), reviewers: ['r1', 'r2'], restoredScopes: ['secret.read'] }), /scope_escalation/);
  store.recordViolation('tenant-1', ref, violation(2, 'CRITICAL'));
  assert.throws(() => store.recertify('tenant-1', ref, { evidenceRoot: sha256('e'), reviewers: ['r1', 'r2'], restoredScopes: ['repository.read'] }), /not_required|new_version/);
});

test('tenant boundaries are explicit and identifier collisions do not cross tenants', () => {
  const store = new PersistentCapabilityTrustStore(root());
  const first = registered(store, 'tenant-1');
  const second = registered(store, 'tenant-2');
  const ref = capabilityRef(first.capabilityId, first.version);
  store.recordViolation('tenant-1', ref, violation(1, 'HIGH'));
  assert.equal(store.get('tenant-1', ref).status, 'QUARANTINED');
  assert.equal(store.get('tenant-2', capabilityRef(second.capabilityId, second.version)).status, 'TRUSTED');
});

test('upgrade is requalification-required and cannot change publisher identity', () => {
  const store = new PersistentCapabilityTrustStore(root());
  const state = registered(store);
  const ref = capabilityRef(state.capabilityId, state.version);
  const upgraded = store.registerUpgrade({ tenantId: 'tenant-1', capabilityId: 'repository-analyzer', version: '2.0.0', publisherId: 'publisher-1', originalScopes: ['repository.read'], predecessorRef: ref });
  assert.equal(upgraded.status, 'REQUALIFICATION_REQUIRED');
  assert.throws(() => store.registerUpgrade({ tenantId: 'tenant-1', capabilityId: 'repository-analyzer', version: '3.0.0', publisherId: 'attacker', originalScopes: ['repository.read'], predecessorRef: ref }), /publisher_mismatch/);
});

test('event tampering and rollback against the anchor fail closed on restart', () => {
  const directory = root();
  const store = new PersistentCapabilityTrustStore(directory);
  const state = registered(store);
  const ref = capabilityRef(state.capabilityId, state.version);
  store.recordViolation('tenant-1', ref, violation(1, 'MEDIUM'));
  const eventsPath = join(directory, 'events.jsonl');
  const lines = readFileSync(eventsPath, 'utf8').trim().split('\n');
  writeFileSync(eventsPath, `${lines[0]}\n`);
  assert.throws(() => new PersistentCapabilityTrustStore(directory), /tampered_or_rolled_back/);

  const second = root();
  const secondStore = new PersistentCapabilityTrustStore(second);
  registered(secondStore);
  appendFileSync(join(second, 'events.jsonl'), '{"forged":true}\n');
  assert.throws(() => new PersistentCapabilityTrustStore(second));
});
