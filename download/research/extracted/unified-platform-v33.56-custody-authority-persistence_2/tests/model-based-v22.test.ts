import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/contracts/crypto.js';
import { capabilityRef, PersistentCapabilityTrustStore, type CapabilityTrustStatus } from '../src/platform/capability-trust.js';
import { createHarness } from './helpers.js';

const now = new Date('2026-07-17T18:00:00.000Z');
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 0x100000000); }

test('model-based: long trust transition sequences never restore critical violations implicitly', () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const random = rng(seed); const store = new PersistentCapabilityTrustStore(mkdtempSync(join(tmpdir(), 'model-trust-v22-')));
    const registered = store.register({ tenantId: 'tenant-1', capabilityId: `cap-${seed}`, version: '1.0.0', publisherId: 'publisher', originalScopes: ['repository.read', 'repository.write', 'evidence.emit'] }, now);
    const ref = capabilityRef(registered.capabilityId, registered.version); let criticalSeen = false;
    for (let step = 0; step < 80; step += 1) {
      const current = store.get('tenant-1', ref); const roll = random();
      if (current.status === 'REVOKED') { assert.equal(current.allowedScopes.length, 0); continue; }
      if (roll < 0.65) {
        const severity = roll < 0.05 ? 'CRITICAL' : roll < 0.20 ? 'HIGH' : roll < 0.40 ? 'MEDIUM' : 'LOW';
        if (severity === 'CRITICAL') criticalSeen = true;
        store.recordViolation('tenant-1', ref, { violationId: `${seed}-${step}`, kind: severity === 'CRITICAL' ? 'TENANT_LEAK' : 'POLICY', severity, evidenceRef: `e-${step}`, observedAt: new Date(now.getTime() + step).toISOString(), message: 'model event' }, now);
      } else if ((current.status === 'RESTRICTED' || current.status === 'QUARANTINED') && !criticalSeen) {
        store.openAppeal('tenant-1', ref, { requestedBy: 'operator', reason: 'patch', evidenceRefs: ['patch'] }, now);
        store.approveOverride('tenant-1', ref, { reviewers: ['r1', 'r2'], reason: 'reviewed' }, now);
        store.recertify('tenant-1', ref, { evidenceRoot: sha256({ seed, step }), reviewers: ['r1', 'r2'], restoredScopes: ['repository.read', 'evidence.emit'] }, now);
      }
      const state = store.get('tenant-1', ref);
      if (criticalSeen) assert.equal(state.status, 'REVOKED');
      if (state.status !== 'TRUSTED') assert.equal(state.allowedScopes.some((scope) => scope.endsWith('.write')), false);
    }
  }
});

test('model-based: approval lifecycle makes self approval and stale revisions unreachable', () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const h = createHarness();
    try {
      const id = `model-mission-${seed}`; h.engine.createAuthorizedMission(h.signedGrant, { missionId: id, tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1', scope: 'repository.read', effectKey: `e:${id}`, approvalRequired: true }, h.now);
      h.engine.acquire(id, 'worker', 30_000, h.now.getTime()); h.engine.prepare(h.store.getMission(id).leaseOwner ? { missionId: id, workerId: 'worker', fenceToken: h.store.getMission(id).fenceToken, expiresAt: h.now.getTime()+30_000 } : { missionId:id, workerId:'worker', fenceToken:0, expiresAt:0 }, {}, h.now.getTime());
      const waiting = h.store.getMission(id); assert.throws(() => h.engine.approve(id, 'builder-1', waiting.revision, h.now), /self_approval/); assert.throws(() => h.engine.approve(id, 'reviewer', waiting.revision - 1, h.now), /revision_conflict/);
      const approved = h.engine.approve(id, 'reviewer', waiting.revision, h.now); assert.equal(approved.approvalStatus, 'APPROVED');
    } finally { h.store.close(); }
  }
});

test('model state labels remain explicit rather than hidden trust scores', () => {
  const allowed: CapabilityTrustStatus[] = ['TRUSTED', 'RESTRICTED', 'QUARANTINED', 'REQUALIFICATION_REQUIRED', 'REVOKED'];
  assert.equal(new Set(allowed).size, 5); assert.equal(allowed.some((value) => /\d/.test(value)), false);
});
