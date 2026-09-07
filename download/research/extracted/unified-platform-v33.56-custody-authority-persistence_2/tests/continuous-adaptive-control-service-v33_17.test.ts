import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import {
  compareShadowExecutionV33_15,
  createWorkflowObservationV33_15,
  discoverShortcutCandidateV33_15,
  issueShortcutPassportV33_15,
  qualifyShortcutCandidateV33_15,
  type WorkflowBoundaryV33_15,
} from '../src/runtime/proof-carrying-adaptive-execution-v33_15.js';
import {
  PersistentAdaptivePolicyControllerV33_16,
  PersistentAdaptivePolicyStoreV33_16,
  type AdaptivePolicyTrustV33_16,
} from '../src/app/persistent-adaptive-policy-controller-v33_16.js';
import { recordApprovalDecision } from '../src/product/chat-mission.js';
import {
  ContinuousAdaptiveControlServiceV33_17,
  ContinuousAdaptiveControlStoreV33_17,
  issueAdaptiveControlScheduleV33_17,
  verifyAdaptiveControlCycleReceiptV33_17,
  type AdaptiveControlTrustV33_17,
} from '../src/app/continuous-adaptive-control-service-v33_17.js';

const baseNow = new Date('2026-07-21T22:00:00.000Z');
let seq = 0;
function id(prefix: string): string { seq += 1; return `${prefix}-${seq}`; }
function registry(...identities: SigningIdentity[]): KeyRegistry { const value = new KeyRegistry(); for (const identity of identities) value.register(identity.keyId, identity.publicKey); return value; }

interface Fixture {
  root: string;
  serviceId: string;
  scheduler: SigningIdentity;
  serviceSigner: SigningIdentity;
  recoverySigner: SigningIdentity;
  controlStoreSigner: SigningIdentity;
  controlTrust: AdaptiveControlTrustV33_17;
  controlStoreRegistry: KeyRegistry;
  controlStore: ContinuousAdaptiveControlStoreV33_17;
  service: ContinuousAdaptiveControlServiceV33_17;
  policyStore: PersistentAdaptivePolicyStoreV33_16;
  controller: PersistentAdaptivePolicyControllerV33_16;
  passportIssuer: SigningIdentity;
  qualifier: SigningIdentity;
  approver: SigningIdentity;
  policyTrust: AdaptivePolicyTrustV33_16;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'continuous-adaptive-v33.17-'));
  const serviceId = 'adaptive-control-main';
  const passportIssuer = generateSigningIdentity(id('passport'));
  const qualifier = generateSigningIdentity(id('qualifier'));
  const activation = generateSigningIdentity(id('activation'));
  const revoker = generateSigningIdentity(id('revoker'));
  const approver = generateSigningIdentity(id('approver'));
  const policyStoreSigner = generateSigningIdentity(id('policy-store'));
  const policyTrust: AdaptivePolicyTrustV33_16 = {
    passportRegistry: registry(passportIssuer), trustedPassportIssuerIds: [passportIssuer.keyId],
    activationRegistry: registry(activation), trustedActivationSignerIds: [activation.keyId],
    revocationRegistry: registry(revoker), trustedRevocationSignerIds: [revoker.keyId],
    approvalRegistry: registry(approver), trustedApproverSignerIds: [approver.keyId],
  };
  const policyStore = new PersistentAdaptivePolicyStoreV33_16({ path: join(root, 'policy.json'), storeIdentity: policyStoreSigner, storeRegistry: registry(policyStoreSigner), trustedStoreSignerIds: [policyStoreSigner.keyId], trust: policyTrust, now: baseNow });
  const controller = new PersistentAdaptivePolicyControllerV33_16({ store: policyStore, trust: policyTrust, activationSigner: activation, revocationSigner: revoker });

  const scheduler = generateSigningIdentity(id('scheduler'));
  const serviceSigner = generateSigningIdentity(id('service'));
  const recoverySigner = generateSigningIdentity(id('recovery'));
  const controlStoreSigner = generateSigningIdentity(id('control-store'));
  const controlTrust: AdaptiveControlTrustV33_17 = {
    scheduleRegistry: registry(scheduler), trustedSchedulerSignerIds: [scheduler.keyId],
    serviceRegistry: registry(serviceSigner), trustedServiceSignerIds: [serviceSigner.keyId],
    recoveryRegistry: registry(recoverySigner), trustedRecoverySignerIds: [recoverySigner.keyId],
  };
  const controlStoreRegistry = registry(controlStoreSigner);
  const controlStore = new ContinuousAdaptiveControlStoreV33_17({ path: join(root, 'control.json'), serviceId, storeIdentity: controlStoreSigner, storeRegistry: controlStoreRegistry, trustedStoreSignerIds: [controlStoreSigner.keyId], trust: controlTrust, now: baseNow });
  const service = new ContinuousAdaptiveControlServiceV33_17({ serviceId, store: controlStore, controller, serviceSigner, recoverySigner, trust: controlTrust });
  return { root, serviceId, scheduler, serviceSigner, recoverySigner, controlStoreSigner, controlTrust, controlStoreRegistry, controlStore, service, policyStore, controller, passportIssuer, qualifier, approver, policyTrust };
}

function cleanup(f: Fixture): void { rmSync(f.root, { recursive: true, force: true }); }
function boundary(workflowType = 'dependency-patch', tenantId = 'tenant-a'): WorkflowBoundaryV33_15 { return { tenantId, workflowType, authorityGrantDigest: sha256(`grant:${tenantId}:${workflowType}`), allowedScopes: ['repository:read', 'repository:shadow-change'], policyDigest: sha256(`policy:${workflowType}`), inputSchemaDigest: sha256(`schema:${workflowType}`), toolchainDigest: sha256(`tool:${workflowType}`), modelSetDigest: sha256(`models:${workflowType}`), riskClass: 'low', reversible: true }; }

function activateShortcut(f: Fixture, b = boundary()) {
  const inputClassDigest = sha256(`input:${b.workflowType}`); const resultDigest = sha256(`result:${b.workflowType}`);
  const observation = (kind: 'TRAINING' | 'HOLDOUT' | 'SHADOW', index: number) => createWorkflowObservationV33_15({ observationId: id(`${kind.toLowerCase()}-${index}`), evidenceClass: kind, boundary: b, inputClassDigest, fullWorkflowResultDigest: resultDigest, fullWorkflowEvidenceRoot: sha256({ kind, index, workflow: b.workflowType }), fullWorkflowPassed: true, userDecision: 'APPROVED', userSteps: 10, approvalCount: 1, costUnits: 10, durationMs: 1000, observedAt: new Date(baseNow.getTime() - 60_000 + index).toISOString(), externalEffectsExecuted: 0 });
  const training = Array.from({ length: 5 }, (_, i) => observation('TRAINING', i));
  const holdout = Array.from({ length: 3 }, (_, i) => observation('HOLDOUT', i));
  const shadow = Array.from({ length: 5 }, (_, i) => observation('SHADOW', i));
  const candidate = discoverShortcutCandidateV33_15({ observations: training, now: baseNow });
  const qualification = qualifyShortcutCandidateV33_15({ candidate, holdoutObservations: holdout, qualifier: f.qualifier, now: baseNow });
  const comparisons = shadow.map((item) => compareShadowExecutionV33_15({ candidate, observation: item, shortcutResultDigest: resultDigest, now: baseNow }));
  const passport = issueShortcutPassportV33_15({ candidate, qualification, qualificationRegistry: registry(f.qualifier), trustedQualifierIds: [f.qualifier.keyId], comparisons, issuer: f.passportIssuer, expiresAt: new Date(baseNow.getTime() + 3_600_000).toISOString(), now: baseNow });
  const row = f.controller.registerShortcut({ passport, projectedCostUnits: 2, projectedDurationMs: 200, projectedUserSteps: 1, evidenceScore: 0.9, now: baseNow });
  const card = f.controller.issueActivationApproval({ recordId: row.recordId, approverIds: [f.approver.keyId], expiresAt: new Date(baseNow.getTime() + 300_000).toISOString(), now: baseNow });
  const decision = recordApprovalDecision(card, { decisionId: id('decision'), cardId: card.cardId, actorId: f.approver.keyId, option: 'YES', occurredAt: new Date(baseNow.getTime() + 100).toISOString() }, new Date(baseNow.getTime() + 200));
  f.controller.activateFromSignedApproval({ recordId: row.recordId, decision: signEnvelope(decision, f.approver), activationExpiresAt: new Date(baseNow.getTime() + 1_800_000).toISOString(), now: new Date(baseNow.getTime() + 200) });
  return { row, boundary: b, inputClassDigest, resultDigest, passport };
}

function schedule(f: Fixture, tenantId = 'tenant-a', overrides: Partial<{ cadenceMs: number; notBefore: string; expiresAt: string; maximumObservationCount: number }> = {}) {
  return issueAdaptiveControlScheduleV33_17({ serviceId: f.serviceId, scheduleId: id('schedule'), tenantId, cadenceMs: overrides.cadenceMs ?? 1000, notBefore: overrides.notBefore ?? baseNow.toISOString(), expiresAt: overrides.expiresAt ?? new Date(baseNow.getTime() + 600_000).toISOString(), maximumObservationCount: overrides.maximumObservationCount ?? 10, scheduler: f.scheduler });
}

function run(f: Fixture, lease: ReturnType<Fixture['controlStore']['acquireLease']>, signedSchedule: ReturnType<typeof schedule>, cycleId: string, now: Date, observations: readonly any[] = []) {
  return f.service.runScheduledCycle({ lease, schedule: signedSchedule, cycle: { cycleId, tenantId: signedSchedule.payload.tenantId, observations }, now });
}

test('runs a signed scheduled drift cycle and emits a verifiable receipt', () => { const f = fixture(); try { const s = schedule(f); f.controlStore.registerSchedule(s, baseNow); const lease = f.controlStore.acquireLease('controller-a', 10_000, baseNow); const receipt = run(f, lease, s, id('cycle'), new Date(baseNow.getTime() + 1000)); assert.equal(receipt.payload.externalEffectsExecuted, 0); assert.equal(verifyAdaptiveControlCycleReceiptV33_17({ envelope: receipt, registry: f.controlTrust.serviceRegistry, trustedSignerIds: f.controlTrust.trustedServiceSignerIds }), true); } finally { cleanup(f); } });
test('prevents two active controllers from holding the lease', () => { const f = fixture(); try { f.controlStore.acquireLease('controller-a', 10_000, baseNow); assert.throws(() => f.controlStore.acquireLease('controller-b', 10_000, new Date(baseNow.getTime() + 1)), /lease_busy/); } finally { cleanup(f); } });
test('renews a lease without changing its fence token', () => { const f = fixture(); try { const lease = f.controlStore.acquireLease('controller-a', 1000, baseNow); const renewed = f.controlStore.renewLease(lease, 5000, new Date(baseNow.getTime() + 100)); assert.equal(renewed.fenceToken, lease.fenceToken); assert.ok(Date.parse(renewed.expiresAt) > Date.parse(lease.expiresAt)); } finally { cleanup(f); } });
test('takeover increments fencing and rejects the stale controller', () => { const f = fixture(); try { const a = f.controlStore.acquireLease('controller-a', 1000, baseNow); const b = f.controlStore.acquireLease('controller-b', 1000, new Date(baseNow.getTime() + 1001)); assert.equal(b.fenceToken, a.fenceToken + 1); assert.throws(() => f.controlStore.assertLease(a, new Date(baseNow.getTime() + 1002)), /stale_fence|lease_expired/); } finally { cleanup(f); } });
test('rejects an untrusted scheduler signature', () => { const f = fixture(); try { const attacker = generateSigningIdentity('attacker'); const bad = issueAdaptiveControlScheduleV33_17({ serviceId: f.serviceId, scheduleId: id('bad'), tenantId: 'tenant-a', cadenceMs: 1000, notBefore: baseNow.toISOString(), expiresAt: new Date(baseNow.getTime() + 5000).toISOString(), maximumObservationCount: 2, scheduler: attacker }); assert.throws(() => f.controlStore.registerSchedule(bad, baseNow), /schedule_signature_invalid/); } finally { cleanup(f); } });
test('rejects a schedule before its window', () => { const f = fixture(); try { const future = schedule(f, 'tenant-a', { notBefore: new Date(baseNow.getTime() + 1000).toISOString() }); assert.throws(() => f.controlStore.registerSchedule(future, baseNow), /schedule_not_active/); } finally { cleanup(f); } });
test('retries a completed cycle idempotently with the same receipt', () => { const f = fixture(); try { const s = schedule(f); f.controlStore.registerSchedule(s, baseNow); const lease = f.controlStore.acquireLease('controller-a', 10_000, baseNow); const now = new Date(baseNow.getTime() + 1000); const cycleId = id('cycle'); const first = run(f, lease, s, cycleId, now); const second = run(f, lease, s, cycleId, now); assert.equal(second.payload.receiptDigest, first.payload.receiptDigest); assert.equal(f.controlStore.snapshot().cycles.length, 1); } finally { cleanup(f); } });
test('rejects two distinct cycles claiming the same schedule slot', () => { const f = fixture(); try { const s = schedule(f); f.controlStore.registerSchedule(s, baseNow); const lease = f.controlStore.acquireLease('controller-a', 10_000, baseNow); const now = new Date(baseNow.getTime() + 1000); run(f, lease, s, id('cycle'), now); assert.throws(() => run(f, lease, s, id('other-cycle'), now), /schedule_slot_already_claimed/); } finally { cleanup(f); } });
test('rejects reuse of a cycle id with changed observations', () => { const f = fixture(); try { const s = schedule(f); f.controlStore.registerSchedule(s, baseNow); const lease = f.controlStore.acquireLease('controller-a', 10_000, baseNow); const now = new Date(baseNow.getTime() + 1000); const cycleId = id('cycle'); run(f, lease, s, cycleId, now); const changed = [{ passportDigest: sha256('p'), currentBoundary: boundary(), inputClassDigest: sha256('i') }]; assert.throws(() => run(f, lease, s, cycleId, now, changed), /cycle_id_payload_conflict/); } finally { cleanup(f); } });
test('recovers a cycle after a crashed owner lease expires', () => { const f = fixture(); try { const s = schedule(f); f.controlStore.registerSchedule(s, baseNow); const a = f.controlStore.acquireLease('controller-a', 1000, baseNow); const cycleId = id('crash-cycle'); const nowA = new Date(baseNow.getTime() + 500); assert.throws(() => f.service.runScheduledCycle({ lease: a, schedule: s, cycle: { cycleId, tenantId: 'tenant-a', observations: [] }, crashAfterStart: true, now: nowA }), /injected_crash/); const bNow = new Date(baseNow.getTime() + 1001); const b = f.controlStore.acquireLease('controller-b', 5000, bNow); const recovery = f.service.createRecoveryReceipt({ cycleId, previousFenceToken: a.fenceToken, lease: b, now: bNow }); const receipt = f.service.runScheduledCycle({ lease: b, schedule: s, cycle: { cycleId, tenantId: 'tenant-a', observations: [] }, recovery, now: bNow }); assert.equal(receipt.payload.recovered, true); assert.equal(f.controlStore.getCycle(cycleId).attempts, 2); } finally { cleanup(f); } });
test('requires a signed recovery receipt to resume an abandoned cycle', () => { const f = fixture(); try { const s = schedule(f); f.controlStore.registerSchedule(s, baseNow); const a = f.controlStore.acquireLease('controller-a', 1000, baseNow); const cycleId = id('crash-cycle'); assert.throws(() => f.service.runScheduledCycle({ lease: a, schedule: s, cycle: { cycleId, tenantId: 'tenant-a', observations: [] }, crashAfterStart: true, now: new Date(baseNow.getTime() + 500) }), /injected_crash/); const bNow = new Date(baseNow.getTime() + 1001); const b = f.controlStore.acquireLease('controller-b', 5000, bNow); assert.throws(() => f.service.runScheduledCycle({ lease: b, schedule: s, cycle: { cycleId, tenantId: 'tenant-a', observations: [] }, now: bNow }), /recovery_receipt_required/); } finally { cleanup(f); } });
test('detects on-disk store tampering', () => { const f = fixture(); try { const path = join(f.root, 'control.json'); const envelope = JSON.parse(readFileSync(path, 'utf8')); envelope.payload.fenceCounter = 999; writeFileSync(path, JSON.stringify(envelope)); assert.throws(() => new ContinuousAdaptiveControlStoreV33_17({ path, serviceId: f.serviceId, storeIdentity: f.controlStoreSigner, storeRegistry: f.controlStoreRegistry, trustedStoreSignerIds: [f.controlStoreSigner.keyId], trust: f.controlTrust, now: baseNow }), /signature|snapshot/); } finally { cleanup(f); } });
test('fails closed on local clock rollback', () => { const f = fixture(); try { f.controlStore.acquireLease('controller-a', 1000, new Date(baseNow.getTime() + 100)); assert.throws(() => f.controlStore.acquireLease('controller-b', 1000, baseNow), /clock_rollback|snapshot_from_future/); } finally { cleanup(f); } });
test('binds schedules and observations to one tenant', () => { const f = fixture(); try { const s = schedule(f, 'tenant-a'); f.controlStore.registerSchedule(s, baseNow); const lease = f.controlStore.acquireLease('controller-a', 5000, baseNow); const other = [{ passportDigest: sha256('p'), currentBoundary: boundary('x', 'tenant-b'), inputClassDigest: sha256('i') }]; assert.throws(() => f.service.runScheduledCycle({ lease, schedule: s, cycle: { cycleId: id('cycle'), tenantId: 'tenant-a', observations: other }, now: new Date(baseNow.getTime() + 1000) }), /observation_tenant_mismatch/); } finally { cleanup(f); } });
test('enforces the observation budget declared by the signed scheduler', () => { const f = fixture(); try { const s = schedule(f, 'tenant-a', { maximumObservationCount: 1 }); f.controlStore.registerSchedule(s, baseNow); const lease = f.controlStore.acquireLease('controller-a', 5000, baseNow); const obs = Array.from({ length: 2 }, (_, i) => ({ passportDigest: sha256(`p${i}`), currentBoundary: boundary(), inputClassDigest: sha256(`i${i}`) })); assert.throws(() => f.service.runScheduledCycle({ lease, schedule: s, cycle: { cycleId: id('cycle'), tenantId: 'tenant-a', observations: obs }, now: new Date(baseNow.getTime() + 1000) }), /observation_budget/); } finally { cleanup(f); } });
test('a scheduled drift cycle revokes a shortcut and records fallback', () => { const f = fixture(); try { const active = activateShortcut(f); const s = schedule(f); f.controlStore.registerSchedule(s, baseNow); const lease = f.controlStore.acquireLease('controller-a', 5000, baseNow); const drifted = { ...active.boundary, toolchainDigest: sha256('changed-tool') }; const receipt = f.service.runScheduledCycle({ lease, schedule: s, cycle: { cycleId: id('drift-cycle'), tenantId: 'tenant-a', observations: [{ passportDigest: active.passport.payload.passportDigest, currentBoundary: drifted, inputClassDigest: active.inputClassDigest }] }, now: new Date(baseNow.getTime() + 1000) }); assert.deepEqual(receipt.payload.revokedRecordIds, [active.row.recordId]); assert.equal(receipt.payload.fallbackRoute, 'FULL_GOVERNED_WORKFLOW'); assert.equal(f.policyStore.get(active.row.recordId).status, 'REVOKED'); } finally { cleanup(f); } });
test('rejects a tampered service receipt', () => { const f = fixture(); try { const s = schedule(f); f.controlStore.registerSchedule(s, baseNow); const lease = f.controlStore.acquireLease('controller-a', 5000, baseNow); const receipt = run(f, lease, s, id('cycle'), new Date(baseNow.getTime() + 1000)); const forged = structuredClone(receipt); (forged.payload as any).externalEffectsExecuted = 1; assert.equal(verifyAdaptiveControlCycleReceiptV33_17({ envelope: forged, registry: f.controlTrust.serviceRegistry, trustedSignerIds: f.controlTrust.trustedServiceSignerIds }), false); } finally { cleanup(f); } });
test('restores leases schedules cycles and event chain after restart', () => { const f = fixture(); try { const s = schedule(f); f.controlStore.registerSchedule(s, baseNow); const lease = f.controlStore.acquireLease('controller-a', 5000, baseNow); run(f, lease, s, id('cycle'), new Date(baseNow.getTime() + 1000)); const reopened = new ContinuousAdaptiveControlStoreV33_17({ path: join(f.root, 'control.json'), serviceId: f.serviceId, storeIdentity: f.controlStoreSigner, storeRegistry: f.controlStoreRegistry, trustedStoreSignerIds: [f.controlStoreSigner.keyId], trust: f.controlTrust, now: new Date(baseNow.getTime() + 1001) }); const snapshot = reopened.snapshot(); assert.equal(snapshot.schedules.length, 1); assert.equal(snapshot.cycles.length, 1); assert.equal(snapshot.cycles[0]?.status, 'COMPLETED'); assert.ok(snapshot.events.length >= 4); } finally { cleanup(f); } });
test('requires store scheduler service and recovery role separation', () => { const f = fixture(); try { const badTrust: AdaptiveControlTrustV33_17 = { ...f.controlTrust, trustedServiceSignerIds: [f.controlStoreSigner.keyId], serviceRegistry: registry(f.controlStoreSigner) }; assert.throws(() => new ContinuousAdaptiveControlStoreV33_17({ path: join(f.root, 'bad-control.json'), serviceId: f.serviceId, storeIdentity: f.controlStoreSigner, storeRegistry: f.controlStoreRegistry, trustedStoreSignerIds: [f.controlStoreSigner.keyId], trust: badTrust, now: baseNow }), /role_separation/); } finally { cleanup(f); } });
test('all persistent service evidence remains shadow-only and effect-free', () => { const f = fixture(); try { const s = schedule(f); f.controlStore.registerSchedule(s, baseNow); const lease = f.controlStore.acquireLease('controller-a', 5000, baseNow); run(f, lease, s, id('cycle'), new Date(baseNow.getTime() + 1000)); const snapshot = f.controlStore.snapshot(); assert.equal(snapshot.externalEffectsExecuted, 0); assert.equal(snapshot.cycles.every((x) => x.externalEffectsExecuted === 0 && x.receipt?.payload.authorityExpanded === false), true); assert.equal(snapshot.events.every((x) => x.externalEffectsExecuted === 0), true); } finally { cleanup(f); } });
