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
  type ShortcutPassportV33_15,
  type WorkflowBoundaryV33_15,
} from '../src/runtime/proof-carrying-adaptive-execution-v33_15.js';
import {
  PersistentAdaptivePolicyControllerV33_16,
  PersistentAdaptivePolicyStoreV33_16,
  type AdaptivePolicyTrustV33_16,
} from '../src/app/persistent-adaptive-policy-controller-v33_16.js';
import { recordApprovalDecision, type ApprovalDecisionRecord, type PushApprovalCard } from '../src/product/chat-mission.js';

const baseNow = new Date('2026-07-21T20:00:00.000Z');

interface Fixture {
  root: string;
  passportIssuer: SigningIdentity;
  qualifier: SigningIdentity;
  activationSigner: SigningIdentity;
  revoker: SigningIdentity;
  approver: SigningIdentity;
  storeSigner: SigningIdentity;
  trust: AdaptivePolicyTrustV33_16;
  storeRegistry: KeyRegistry;
  store: PersistentAdaptivePolicyStoreV33_16;
  controller: PersistentAdaptivePolicyControllerV33_16;
}

function registry(...ids: SigningIdentity[]): KeyRegistry {
  const value = new KeyRegistry();
  for (const id of ids) value.register(id.keyId, id.publicKey);
  return value;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'adaptive-v33.16-'));
  const passportIssuer = generateSigningIdentity('passport-issuer');
  const qualifier = generateSigningIdentity('qualifier');
  const activationSigner = generateSigningIdentity('activation-controller');
  const revoker = generateSigningIdentity('drift-revoker');
  const approver = generateSigningIdentity('human-approver');
  const storeSigner = generateSigningIdentity('adaptive-store');
  const trust: AdaptivePolicyTrustV33_16 = {
    passportRegistry: registry(passportIssuer), trustedPassportIssuerIds: [passportIssuer.keyId],
    activationRegistry: registry(activationSigner), trustedActivationSignerIds: [activationSigner.keyId],
    revocationRegistry: registry(revoker), trustedRevocationSignerIds: [revoker.keyId],
    approvalRegistry: registry(approver), trustedApproverSignerIds: [approver.keyId],
  };
  const storeRegistry = registry(storeSigner);
  const store = new PersistentAdaptivePolicyStoreV33_16({ path: join(root, 'policy-store.json'), storeIdentity: storeSigner, storeRegistry, trustedStoreSignerIds: [storeSigner.keyId], trust, now: baseNow });
  const controller = new PersistentAdaptivePolicyControllerV33_16({ store, trust, activationSigner, revocationSigner: revoker });
  return { root, passportIssuer, qualifier, activationSigner, revoker, approver, storeSigner, trust, storeRegistry, store, controller };
}

function boundary(workflowType = 'dependency-patch', tenantId = 'tenant-a', overrides: Partial<WorkflowBoundaryV33_15> = {}): WorkflowBoundaryV33_15 {
  return {
    tenantId, workflowType,
    authorityGrantDigest: sha256(`grant:${tenantId}:${workflowType}`),
    allowedScopes: ['repository:read', 'repository:shadow-change'],
    policyDigest: sha256(`policy:${workflowType}`),
    inputSchemaDigest: sha256(`schema:${workflowType}`),
    toolchainDigest: sha256(`toolchain:${workflowType}`),
    modelSetDigest: sha256(`models:${workflowType}`),
    riskClass: 'low', reversible: true, ...overrides,
  };
}

function passport(f: Fixture, b: WorkflowBoundaryV33_15, resultDigest = sha256(`result:${b.workflowType}`), now = baseNow) {
  const inputClassDigest = sha256(`input:${b.workflowType}`);
  const observation = (id: string, evidenceClass: 'TRAINING' | 'HOLDOUT' | 'SHADOW') => createWorkflowObservationV33_15({
    observationId: id, evidenceClass, boundary: b, inputClassDigest,
    fullWorkflowResultDigest: resultDigest, fullWorkflowEvidenceRoot: sha256({ id, workflow: b.workflowType }),
    fullWorkflowPassed: true, userDecision: 'APPROVED', userSteps: 10, approvalCount: 1,
    costUnits: 10, durationMs: 1000, observedAt: new Date(now.getTime() - 60_000).toISOString(), externalEffectsExecuted: 0,
  });
  const training = Array.from({ length: 5 }, (_, i) => observation(`${b.workflowType}-train-${randomTag()}-${i}`, 'TRAINING'));
  const holdout = Array.from({ length: 3 }, (_, i) => observation(`${b.workflowType}-hold-${randomTag()}-${i}`, 'HOLDOUT'));
  const shadow = Array.from({ length: 5 }, (_, i) => observation(`${b.workflowType}-shadow-${randomTag()}-${i}`, 'SHADOW'));
  const candidate = discoverShortcutCandidateV33_15({ observations: training, now });
  const qualification = qualifyShortcutCandidateV33_15({ candidate, holdoutObservations: holdout, qualifier: f.qualifier, now });
  const comparisons = shadow.map((item) => compareShadowExecutionV33_15({ candidate, observation: item, shortcutResultDigest: resultDigest, now }));
  const passport = issueShortcutPassportV33_15({ candidate, qualification, qualificationRegistry: registry(f.qualifier), trustedQualifierIds: [f.qualifier.keyId], comparisons, issuer: f.passportIssuer, expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), now });
  return { passport, inputClassDigest, resultDigest, boundary: b };
}

let tag = 0;
function randomTag(): string { tag += 1; return String(tag); }

function approve(f: Fixture, recordId: string, now = baseNow) {
  const card = f.controller.issueActivationApproval({ recordId, approverIds: [f.approver.keyId], expiresAt: new Date(now.getTime() + 3_600_000).toISOString(), now });
  const decision = recordApprovalDecision(card, { decisionId: `decision-${randomTag()}`, cardId: card.cardId, actorId: f.approver.keyId, option: 'YES', occurredAt: new Date(now.getTime() + 1_000).toISOString() }, new Date(now.getTime() + 2_000));
  const signed = signEnvelope(decision, f.approver);
  return f.controller.activateFromSignedApproval({ recordId, decision: signed, activationExpiresAt: new Date(now.getTime() + 7_200_000).toISOString(), now: new Date(now.getTime() + 2_000) });
}

function register(f: Fixture, p: ReturnType<typeof passport>, projection = { projectedCostUnits: 3, projectedDurationMs: 200, projectedUserSteps: 1, evidenceScore: 0.9 }) {
  return f.controller.registerShortcut({ passport: p.passport, ...projection, now: baseNow });
}

function cleanup(f: Fixture): void { rmSync(f.root, { recursive: true, force: true }); }

function signedDecision(card: PushApprovalCard, identity: SigningIdentity, overrides: Partial<ApprovalDecisionRecord> = {}) {
  const decision = recordApprovalDecision(card, { decisionId: `decision-${randomTag()}`, cardId: card.cardId, actorId: identity.keyId, option: 'YES', occurredAt: new Date(baseNow.getTime() + 1_000).toISOString() }, new Date(baseNow.getTime() + 2_000));
  const material = { ...decision, ...overrides } as ApprovalDecisionRecord;
  const { decisionDigest: _old, ...without } = material;
  return signEnvelope({ ...without, decisionDigest: sha256(without) }, identity);
}

test('persists and restores an activated shortcut with signed event chain', () => {
  const f = fixture(); try {
    const p = passport(f, boundary()); const row = register(f, p); approve(f, row.recordId);
    const reopened = new PersistentAdaptivePolicyStoreV33_16({ path: join(f.root, 'policy-store.json'), storeIdentity: f.storeSigner, storeRegistry: f.storeRegistry, trustedStoreSignerIds: [f.storeSigner.keyId], trust: f.trust, now: new Date(baseNow.getTime() + 3_000) });
    assert.equal(reopened.get(row.recordId).status, 'ACTIVE'); assert.equal(reopened.events().length, 3);
  } finally { cleanup(f); }
});

test('rejects a tampered snapshot without a valid store signature', () => {
  const f = fixture(); try {
    const path = join(f.root, 'policy-store.json'); const envelope = JSON.parse(readFileSync(path, 'utf8'));
    envelope.payload.generatedAt = '2026-07-21T20:00:01.000Z';
    writeFileSync(path, JSON.stringify(envelope));
    assert.throws(() => new PersistentAdaptivePolicyStoreV33_16({ path, storeIdentity: f.storeSigner, storeRegistry: f.storeRegistry, trustedStoreSignerIds: [f.storeSigner.keyId], trust: f.trust, now: baseNow }), /signature|snapshot/);
  } finally { cleanup(f); }
});

test('requires a signed human approval before activation', () => {
  const f = fixture(); try {
    const row = register(f, passport(f, boundary())); const card = f.controller.issueActivationApproval({ recordId: row.recordId, approverIds: [f.approver.keyId], expiresAt: new Date(baseNow.getTime() + 3_600_000).toISOString(), now: baseNow });
    const attacker = generateSigningIdentity('attacker');
    assert.throws(() => f.controller.activateFromSignedApproval({ recordId: row.recordId, decision: signedDecision(card, attacker), activationExpiresAt: new Date(baseNow.getTime() + 7_200_000).toISOString(), now: new Date(baseNow.getTime() + 2_000) }), /signature|actor/);
  } finally { cleanup(f); }
});

test('rejects approval scope expansion even when signed by an approver', () => {
  const f = fixture(); try {
    const row = register(f, passport(f, boundary())); const card = f.controller.issueActivationApproval({ recordId: row.recordId, approverIds: [f.approver.keyId], expiresAt: new Date(baseNow.getTime() + 3_600_000).toISOString(), now: baseNow });
    const forged = signedDecision(card, f.approver, { approvedScopes: [...card.requestedScopes, 'production:deploy'] });
    assert.throws(() => f.controller.activateFromSignedApproval({ recordId: row.recordId, decision: forged, activationExpiresAt: new Date(baseNow.getTime() + 7_200_000).toISOString(), now: new Date(baseNow.getTime() + 2_000) }), /scope/);
  } finally { cleanup(f); }
});

test('selects the cheapest equivalent active shortcut under budget', () => {
  const f = fixture(); try {
    const b = boundary(); const p1 = passport(f, b); const p2 = passport(f, b, p1.resultDigest);
    const expensive = register(f, p1, { projectedCostUnits: 5, projectedDurationMs: 400, projectedUserSteps: 2, evidenceScore: 0.99 });
    const cheap = register(f, p2, { projectedCostUnits: 2, projectedDurationMs: 300, projectedUserSteps: 1, evidenceScore: 0.8 });
    approve(f, expensive.recordId); approve(f, cheap.recordId);
    const route = f.controller.route({ tenantId: b.tenantId, workflowType: b.workflowType, currentBoundary: b, inputClassDigest: p1.inputClassDigest, budget: { maximumCostUnits: 10, maximumDurationMs: 1000, maximumUserSteps: 5 }, now: new Date(baseNow.getTime() + 3_000) });
    assert.equal(route.route, 'QUALIFIED_SHORTCUT_SHADOW'); assert.equal(route.selectedRecordId, cheap.recordId);
  } finally { cleanup(f); }
});

test('falls back when equivalent candidates exceed the budget', () => {
  const f = fixture(); try {
    const p = passport(f, boundary()); const row = register(f, p, { projectedCostUnits: 5, projectedDurationMs: 500, projectedUserSteps: 2, evidenceScore: 1 }); approve(f, row.recordId);
    const route = f.controller.route({ tenantId: p.boundary.tenantId, workflowType: p.boundary.workflowType, currentBoundary: p.boundary, inputClassDigest: p.inputClassDigest, budget: { maximumCostUnits: 1, maximumDurationMs: 100, maximumUserSteps: 1 }, now: new Date(baseNow.getTime() + 3_000) });
    assert.equal(route.route, 'FULL_GOVERNED_WORKFLOW'); assert.equal(route.reason, 'BUDGET_REJECTED');
  } finally { cleanup(f); }
});

test('falls back on conflicting projected result digests', () => {
  const f = fixture(); try {
    const b = boundary(); const p1 = passport(f, b, sha256('result-one')); const p2 = passport(f, b, sha256('result-two'));
    const r1 = register(f, p1); const r2 = register(f, p2); approve(f, r1.recordId); approve(f, r2.recordId);
    const route = f.controller.route({ tenantId: b.tenantId, workflowType: b.workflowType, currentBoundary: b, inputClassDigest: p1.inputClassDigest, budget: { maximumCostUnits: 10, maximumDurationMs: 1000, maximumUserSteps: 5 }, now: new Date(baseNow.getTime() + 3_000) });
    assert.equal(route.reason, 'CONFLICTING_RESULT_DIGESTS');
  } finally { cleanup(f); }
});

test('isolates workflow types and tenants', () => {
  const f = fixture(); try {
    const p = passport(f, boundary('workflow-a', 'tenant-a')); const row = register(f, p); approve(f, row.recordId);
    const other = boundary('workflow-a', 'tenant-b');
    const route = f.controller.route({ tenantId: 'tenant-b', workflowType: 'workflow-a', currentBoundary: other, inputClassDigest: p.inputClassDigest, budget: { maximumCostUnits: 10, maximumDurationMs: 1000, maximumUserSteps: 5 }, now: new Date(baseNow.getTime() + 3_000) });
    assert.equal(route.reason, 'NO_ACTIVE_SHORTCUT');
  } finally { cleanup(f); }
});

test('drift sweep revokes an active shortcut and future routing falls back', () => {
  const f = fixture(); try {
    const p = passport(f, boundary()); const row = register(f, p); approve(f, row.recordId);
    const drifted = { ...p.boundary, toolchainDigest: sha256('changed-toolchain') };
    const report = f.controller.sweepDrift({ observations: [{ passportDigest: p.passport.payload.passportDigest, currentBoundary: drifted, inputClassDigest: p.inputClassDigest }], now: new Date(baseNow.getTime() + 4_000) });
    assert.deepEqual(report.revokedRecordIds, [row.recordId]); assert.equal(f.store.get(row.recordId).status, 'REVOKED');
    const route = f.controller.route({ tenantId: p.boundary.tenantId, workflowType: p.boundary.workflowType, currentBoundary: p.boundary, inputClassDigest: p.inputClassDigest, budget: { maximumCostUnits: 10, maximumDurationMs: 1000, maximumUserSteps: 5 }, now: new Date(baseNow.getTime() + 5_000) });
    assert.equal(route.route, 'FULL_GOVERNED_WORKFLOW');
  } finally { cleanup(f); }
});

test('result mismatch creates an automatic revocation', () => {
  const f = fixture(); try {
    const p = passport(f, boundary()); const row = register(f, p); approve(f, row.recordId);
    const route = f.controller.route({ tenantId: p.boundary.tenantId, workflowType: p.boundary.workflowType, currentBoundary: p.boundary, inputClassDigest: p.inputClassDigest, budget: { maximumCostUnits: 10, maximumDurationMs: 1000, maximumUserSteps: 5 }, now: new Date(baseNow.getTime() + 3_000) });
    const audit = f.controller.recordOutcome({ routingDecision: route, observedResultDigest: sha256('wrong-result'), baselineCostUnits: 10, actualCostUnits: 2, baselineDurationMs: 1000, actualDurationMs: 200, baselineUserSteps: 10, actualUserSteps: 1, now: new Date(baseNow.getTime() + 4_000) });
    assert.equal(audit.resultMatched, false); assert.equal(f.store.get(row.recordId).status, 'REVOKED');
  } finally { cleanup(f); }
});

test('records measured savings without claiming external effects', () => {
  const f = fixture(); try {
    const p = passport(f, boundary()); const row = register(f, p); approve(f, row.recordId);
    const route = f.controller.route({ tenantId: p.boundary.tenantId, workflowType: p.boundary.workflowType, currentBoundary: p.boundary, inputClassDigest: p.inputClassDigest, budget: { maximumCostUnits: 10, maximumDurationMs: 1000, maximumUserSteps: 5 }, now: new Date(baseNow.getTime() + 3_000) });
    const audit = f.controller.recordOutcome({ routingDecision: route, observedResultDigest: p.resultDigest, baselineCostUnits: 10, actualCostUnits: 2, baselineDurationMs: 1000, actualDurationMs: 200, baselineUserSteps: 10, actualUserSteps: 1, now: new Date(baseNow.getTime() + 4_000) });
    assert.equal(audit.costSavingsUnits, 8); assert.equal(audit.durationSavingsMs, 800); assert.equal(audit.userStepSavings, 9); assert.equal(audit.externalEffectsExecuted, 0);
  } finally { cleanup(f); }
});

test('expires an activation and records fallback', () => {
  const f = fixture(); try {
    const p = passport(f, boundary()); const row = register(f, p); approve(f, row.recordId);
    const report = f.controller.sweepDrift({ observations: [], now: new Date(baseNow.getTime() + 8_000_000) });
    assert.deepEqual(report.expiredRecordIds, [row.recordId]); assert.equal(f.store.get(row.recordId).status, 'EXPIRED');
  } finally { cleanup(f); }
});

test('manual revocation is terminal for routing', () => {
  const f = fixture(); try {
    const p = passport(f, boundary()); const row = register(f, p); approve(f, row.recordId); f.controller.manualRevoke(row.recordId, { operator: 'stop' }, new Date(baseNow.getTime() + 3_000));
    const route = f.controller.route({ tenantId: p.boundary.tenantId, workflowType: p.boundary.workflowType, currentBoundary: p.boundary, inputClassDigest: p.inputClassDigest, budget: { maximumCostUnits: 10, maximumDurationMs: 1000, maximumUserSteps: 5 }, now: new Date(baseNow.getTime() + 4_000) });
    assert.equal(route.reason, 'NO_ACTIVE_SHORTCUT');
  } finally { cleanup(f); }
});

test('supports multiple distinct workflow classes in one persistent store', () => {
  const f = fixture(); try {
    for (const workflow of ['dependency-patch', 'test-repair', 'documentation-refresh']) { const p = passport(f, boundary(workflow)); const row = register(f, p); approve(f, row.recordId); }
    assert.equal(f.store.list('tenant-a').filter((x) => x.status === 'ACTIVE').length, 3);
  } finally { cleanup(f); }
});

test('rejects a store opened with an untrusted signer list', () => {
  const f = fixture(); try {
    assert.throws(() => new PersistentAdaptivePolicyStoreV33_16({ path: join(f.root, 'policy-store.json'), storeIdentity: f.storeSigner, storeRegistry: f.storeRegistry, trustedStoreSignerIds: ['other'], trust: f.trust, now: baseNow }), /signer_untrusted/);
  } finally { cleanup(f); }
});



test('budget fuzz never selects a shortcut outside any declared limit', () => {
  const f = fixture(); try {
    const p = passport(f, boundary()); const row = register(f, p, { projectedCostUnits: 4, projectedDurationMs: 400, projectedUserSteps: 2, evidenceScore: 0.9 }); approve(f, row.recordId);
    let seed = 17;
    for (let i = 0; i < 120; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const budget = { maximumCostUnits: seed % 8, maximumDurationMs: seed % 800, maximumUserSteps: seed % 5 };
      const route = f.controller.route({ tenantId: p.boundary.tenantId, workflowType: p.boundary.workflowType, currentBoundary: p.boundary, inputClassDigest: p.inputClassDigest, budget, now: new Date(baseNow.getTime() + 3_000 + i) });
      const fits = budget.maximumCostUnits >= 4 && budget.maximumDurationMs >= 400 && budget.maximumUserSteps >= 2;
      assert.equal(route.route === 'QUALIFIED_SHORTCUT_SHADOW', fits);
      assert.equal(route.authorityExpanded, false);
    }
  } finally { cleanup(f); }
});

test('tamper matrix rejects changed records audits events digests and signatures', () => {
  const f = fixture(); try {
    const p = passport(f, boundary()); const row = register(f, p); approve(f, row.recordId);
    const route = f.controller.route({ tenantId: p.boundary.tenantId, workflowType: p.boundary.workflowType, currentBoundary: p.boundary, inputClassDigest: p.inputClassDigest, budget: { maximumCostUnits: 10, maximumDurationMs: 1000, maximumUserSteps: 5 }, now: new Date(baseNow.getTime() + 3_000) });
    f.controller.recordOutcome({ routingDecision: route, observedResultDigest: p.resultDigest, baselineCostUnits: 10, actualCostUnits: 2, baselineDurationMs: 1000, actualDurationMs: 200, baselineUserSteps: 10, actualUserSteps: 1, now: new Date(baseNow.getTime() + 4_000) });
    const path = join(f.root, 'policy-store.json'); const original = readFileSync(path, 'utf8');
    const mutations = [
      (x: any) => { x.payload.records[0].status = 'REVOKED'; },
      (x: any) => { x.payload.records[0].projection.projectedCostUnits = 0; },
      (x: any) => { x.payload.audits[0].actualCostUnits = 0; },
      (x: any) => { x.payload.events[0].previousEventDigest = sha256('forged'); },
      (x: any) => { x.payload.snapshotDigest = sha256('forged'); },
      (x: any) => { x.signature = `${x.signature.slice(0, -2)}aa`; },
    ];
    for (const mutate of mutations) {
      const changed = JSON.parse(original); mutate(changed); writeFileSync(path, JSON.stringify(changed));
      assert.throws(() => new PersistentAdaptivePolicyStoreV33_16({ path, storeIdentity: f.storeSigner, storeRegistry: f.storeRegistry, trustedStoreSignerIds: [f.storeSigner.keyId], trust: f.trust, now: new Date(baseNow.getTime() + 5_000) }));
      writeFileSync(path, original);
    }
  } finally { cleanup(f); }
});
test('controller requires separate activation and revocation identities', () => {
  const f = fixture(); try {
    assert.throws(() => new PersistentAdaptivePolicyControllerV33_16({ store: f.store, trust: f.trust, activationSigner: f.activationSigner, revocationSigner: f.activationSigner }), /separation/);
  } finally { cleanup(f); }
});
