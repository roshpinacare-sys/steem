import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../src/contracts/crypto.js';
import {
  activateShortcutPassportV33_15,
  compareShadowExecutionV33_15,
  createShortcutRevocationV33_15,
  createWorkflowObservationV33_15,
  detectShortcutDriftV33_15,
  discoverShortcutCandidateV33_15,
  issueShortcutPassportV33_15,
  qualifyShortcutCandidateV33_15,
  routeAdaptiveExecutionV33_15,
  verifyShortcutPassportV33_15,
  verifyShortcutQualificationV33_15,
  verifyWorkflowObservationV33_15,
  type WorkflowBoundaryV33_15,
  type WorkflowObservationV33_15,
} from '../src/runtime/proof-carrying-adaptive-execution-v33_15.js';

const baseTime = Date.parse('2026-07-21T12:00:00.000Z');
const now = new Date(baseTime);
const passportExpiry = new Date(baseTime + 24 * 60 * 60 * 1000).toISOString();
const activationExpiry = new Date(baseTime + 6 * 60 * 60 * 1000).toISOString();

function registry(...ids: ReturnType<typeof generateSigningIdentity>[]): KeyRegistry {
  const r = new KeyRegistry();
  for (const id of ids) r.register(id.keyId, id.publicKey);
  return r;
}

const boundary: WorkflowBoundaryV33_15 = {
  tenantId: 'tenant-a',
  workflowType: 'dependency-patch-update',
  authorityGrantDigest: sha256('grant-a'),
  allowedScopes: ['repository:read', 'repository:shadow-change'],
  policyDigest: sha256('policy-a'),
  inputSchemaDigest: sha256('schema-a'),
  toolchainDigest: sha256('toolchain-a'),
  modelSetDigest: sha256('models-a'),
  riskClass: 'low',
  reversible: true,
};
const inputClassDigest = sha256('patch-update-no-api-change');
const resultDigest = sha256('equivalent-reviewed-result');

function observation(id: string, evidenceClass: WorkflowObservationV33_15['evidenceClass'], overrides: Partial<Parameters<typeof createWorkflowObservationV33_15>[0]> = {}) {
  return createWorkflowObservationV33_15({
    observationId: id,
    evidenceClass,
    boundary,
    inputClassDigest,
    fullWorkflowResultDigest: resultDigest,
    fullWorkflowEvidenceRoot: sha256(`evidence-${id}`),
    fullWorkflowPassed: true,
    userDecision: 'APPROVED',
    userSteps: 10,
    approvalCount: 1,
    costUnits: 10,
    durationMs: 1000,
    observedAt: new Date(baseTime - 60_000).toISOString(),
    externalEffectsExecuted: 0,
    ...overrides,
  });
}

function qualifiedFixture() {
  const qualifier = generateSigningIdentity('shortcut-qualifier');
  const passportIssuer = generateSigningIdentity('shortcut-passport-issuer');
  const activator = generateSigningIdentity('shortcut-user-activation');
  const revoker = generateSigningIdentity('shortcut-revoker');
  const candidate = discoverShortcutCandidateV33_15({ observations: Array.from({ length: 5 }, (_, i) => observation(`train-${i}`, 'TRAINING')), now });
  const qualification = qualifyShortcutCandidateV33_15({ candidate, holdoutObservations: Array.from({ length: 3 }, (_, i) => observation(`holdout-${i}`, 'HOLDOUT')), qualifier, now });
  const comparisons = Array.from({ length: 5 }, (_, i) => compareShadowExecutionV33_15({ candidate, observation: observation(`shadow-${i}`, 'SHADOW'), shortcutResultDigest: resultDigest, now }));
  const passport = issueShortcutPassportV33_15({ candidate, qualification, qualificationRegistry: registry(qualifier), trustedQualifierIds: [qualifier.keyId], comparisons, issuer: passportIssuer, expiresAt: passportExpiry, now });
  const activation = activateShortcutPassportV33_15({ passport, passportRegistry: registry(passportIssuer), trustedPassportIssuerIds: [passportIssuer.keyId], approvedBy: 'user-a', approvedScopes: boundary.allowedScopes, signer: activator, expiresAt: activationExpiry, now });
  return { qualifier, passportIssuer, activator, revoker, candidate, qualification, comparisons, passport, activation };
}

test('uniform training observations create a shadow-only candidate', () => {
  const candidate = discoverShortcutCandidateV33_15({ observations: Array.from({ length: 5 }, (_, i) => observation(`train-uniform-${i}`, 'TRAINING')), now });
  assert.equal(candidate.promotionCeiling, 'shadow');
  assert.equal(candidate.maximumMismatchCount, 0);
  assert.equal(candidate.externalEffectsExecuted, 0);
  assert.deepEqual(candidate.allowedScopes, [...boundary.allowedScopes].sort());
});

test('candidate discovery rejects too little data, failure, high risk, non-reversible and nondeterminism', () => {
  assert.throws(() => discoverShortcutCandidateV33_15({ observations: [observation('short-1', 'TRAINING')], now }), /insufficient_training/);
  assert.throws(() => discoverShortcutCandidateV33_15({ observations: Array.from({ length: 5 }, (_, i) => observation(`fail-${i}`, 'TRAINING', i === 4 ? { fullWorkflowPassed: false } : {})), now }), /training_full_workflow_failure/);
  assert.throws(() => discoverShortcutCandidateV33_15({ observations: Array.from({ length: 5 }, (_, i) => observation(`risk-${i}`, 'TRAINING', { boundary: { ...boundary, riskClass: 'high' } })), now }), /training_risk_too_high/);
  assert.throws(() => discoverShortcutCandidateV33_15({ observations: Array.from({ length: 5 }, (_, i) => observation(`rev-${i}`, 'TRAINING', { boundary: { ...boundary, reversible: false } })), now }), /training_reversibility_required/);
  assert.throws(() => discoverShortcutCandidateV33_15({ observations: Array.from({ length: 5 }, (_, i) => observation(`det-${i}`, 'TRAINING', i === 4 ? { fullWorkflowResultDigest: sha256('different') } : {})), now }), /training_result_not_deterministic/);
});

test('tampered observation and duplicate evidence are rejected', () => {
  const good = observation('tamper-a', 'TRAINING');
  const changed = { ...good, userSteps: 1 };
  assert.equal(verifyWorkflowObservationV33_15(changed), false);
  assert.throws(() => discoverShortcutCandidateV33_15({ observations: [good, good, observation('tamper-b', 'TRAINING'), observation('tamper-c', 'TRAINING'), observation('tamper-d', 'TRAINING')], now }), /duplicate_observation/);
});

test('holdout must be separate, sufficient, trusted and result-equivalent', () => {
  const qualifier = generateSigningIdentity('q-holdout');
  const candidate = discoverShortcutCandidateV33_15({ observations: Array.from({ length: 5 }, (_, i) => observation(`train-h-${i}`, 'TRAINING')), now });
  assert.throws(() => qualifyShortcutCandidateV33_15({ candidate, holdoutObservations: [observation('h-1', 'HOLDOUT')], qualifier, now }), /insufficient_holdout/);
  assert.throws(() => qualifyShortcutCandidateV33_15({ candidate, holdoutObservations: [observation('train-h-0', 'HOLDOUT'), observation('h-2', 'HOLDOUT'), observation('h-3', 'HOLDOUT')], qualifier, now }), /holdout_training_overlap/);
  assert.throws(() => qualifyShortcutCandidateV33_15({ candidate, holdoutObservations: [observation('hm-1', 'HOLDOUT'), observation('hm-2', 'HOLDOUT'), observation('hm-3', 'HOLDOUT', { fullWorkflowResultDigest: sha256('mismatch') })], qualifier, now }), /holdout_result_mismatch/);
  const qualification = qualifyShortcutCandidateV33_15({ candidate, holdoutObservations: [observation('hq-1', 'HOLDOUT'), observation('hq-2', 'HOLDOUT'), observation('hq-3', 'HOLDOUT')], qualifier, now });
  assert.equal(verifyShortcutQualificationV33_15({ envelope: qualification, registry: registry(qualifier), expectedCandidateDigest: candidate.candidateDigest, trustedSignerIds: [qualifier.keyId] }), true);
  assert.equal(verifyShortcutQualificationV33_15({ envelope: qualification, registry: registry(qualifier), expectedCandidateDigest: candidate.candidateDigest, trustedSignerIds: ['other'] }), false);
});

test('shadow mismatch prevents passport issuance and duplicate comparisons do not count twice', () => {
  const qualifier = generateSigningIdentity('q-shadow');
  const issuer = generateSigningIdentity('issuer-shadow');
  const candidate = discoverShortcutCandidateV33_15({ observations: Array.from({ length: 5 }, (_, i) => observation(`train-s-${i}`, 'TRAINING')), now });
  const qualification = qualifyShortcutCandidateV33_15({ candidate, holdoutObservations: Array.from({ length: 3 }, (_, i) => observation(`hold-s-${i}`, 'HOLDOUT')), qualifier, now });
  const good = compareShadowExecutionV33_15({ candidate, observation: observation('shadow-good', 'SHADOW'), shortcutResultDigest: resultDigest, now });
  const bad = compareShadowExecutionV33_15({ candidate, observation: observation('shadow-bad', 'SHADOW'), shortcutResultDigest: sha256('bad'), now });
  assert.equal(bad.match, false);
  assert.throws(() => issueShortcutPassportV33_15({ candidate, qualification, qualificationRegistry: registry(qualifier), trustedQualifierIds: [qualifier.keyId], comparisons: [good, good, good, good, good], issuer, expiresAt: passportExpiry, now }), /duplicate_shadow_comparison/);
  assert.throws(() => issueShortcutPassportV33_15({ candidate, qualification, qualificationRegistry: registry(qualifier), trustedQualifierIds: [qualifier.keyId], comparisons: [good, ...Array.from({ length: 3 }, (_, i) => compareShadowExecutionV33_15({ candidate, observation: observation(`shadow-ok-${i}`, 'SHADOW'), shortcutResultDigest: resultDigest, now })), bad], issuer, expiresAt: passportExpiry, now }), /shadow_mismatch/);
});

test('passport issuer must be independent from qualifier', () => {
  const qualifier = generateSigningIdentity('same-role');
  const candidate = discoverShortcutCandidateV33_15({ observations: Array.from({ length: 5 }, (_, i) => observation(`train-i-${i}`, 'TRAINING')), now });
  const qualification = qualifyShortcutCandidateV33_15({ candidate, holdoutObservations: Array.from({ length: 3 }, (_, i) => observation(`hold-i-${i}`, 'HOLDOUT')), qualifier, now });
  const comparisons = Array.from({ length: 5 }, (_, i) => compareShadowExecutionV33_15({ candidate, observation: observation(`shadow-i-${i}`, 'SHADOW'), shortcutResultDigest: resultDigest, now }));
  assert.throws(() => issueShortcutPassportV33_15({ candidate, qualification, qualificationRegistry: registry(qualifier), trustedQualifierIds: [qualifier.keyId], comparisons, issuer: qualifier, expiresAt: passportExpiry, now }), /independent/);
});

test('valid passport is signed, expiring, revocable and explicitly activated', () => {
  const f = qualifiedFixture();
  assert.equal(verifyShortcutPassportV33_15({ envelope: f.passport, registry: registry(f.passportIssuer), trustedIssuerIds: [f.passportIssuer.keyId], now }), true);
  assert.equal(f.passport.payload.requiresExplicitActivation, true);
  assert.equal(f.passport.payload.fallbackRoute, 'FULL_GOVERNED_WORKFLOW');
  assert.equal(f.activation.payload.activationCeiling, 'limited-revocable');
});

test('untrusted passport signer and recomputed inner digest cannot verify', () => {
  const f = qualifiedFixture();
  assert.equal(verifyShortcutPassportV33_15({ envelope: f.passport, registry: registry(f.passportIssuer), trustedIssuerIds: ['unknown'], now }), false);
  const payload = { ...f.passport.payload, allowedScopes: ['repository:read'] };
  const { passportDigest: _old, ...material } = payload;
  const forged = { ...f.passport, payload: { ...payload, passportDigest: sha256(material) } };
  assert.equal(verifyShortcutPassportV33_15({ envelope: forged, registry: registry(f.passportIssuer), trustedIssuerIds: [f.passportIssuer.keyId], now }), false);
});

test('activation cannot widen scopes or outlive passport', () => {
  const f = qualifiedFixture();
  assert.throws(() => activateShortcutPassportV33_15({ passport: f.passport, passportRegistry: registry(f.passportIssuer), trustedPassportIssuerIds: [f.passportIssuer.keyId], approvedBy: 'user', approvedScopes: [...boundary.allowedScopes, 'repository:merge'], signer: f.activator, expiresAt: activationExpiry, now }), /scope_expansion/);
  assert.throws(() => activateShortcutPassportV33_15({ passport: f.passport, passportRegistry: registry(f.passportIssuer), trustedPassportIssuerIds: [f.passportIssuer.keyId], approvedBy: 'user', approvedScopes: boundary.allowedScopes, signer: f.activator, expiresAt: new Date(Date.parse(passportExpiry) + 1).toISOString(), now }), /activation_expiry_invalid/);
});

test('qualified route is shadow-only and executes no external effect', () => {
  const f = qualifiedFixture();
  const decision = routeAdaptiveExecutionV33_15({ passport: f.passport, passportRegistry: registry(f.passportIssuer), trustedPassportIssuerIds: [f.passportIssuer.keyId], activation: f.activation, activationRegistry: registry(f.activator), trustedActivationSignerIds: [f.activator.keyId], currentBoundary: boundary, inputClassDigest, now });
  assert.equal(decision.route, 'QUALIFIED_SHORTCUT_SHADOW');
  assert.equal(decision.reason, 'QUALIFIED_AND_ACTIVATED');
  assert.equal(decision.authorityExpanded, false);
  assert.equal(decision.externalEffectsExecuted, 0);
});

test('policy, authority, scope, schema, toolchain, model and result drift are detected', () => {
  const f = qualifiedFixture();
  assert.equal(detectShortcutDriftV33_15({ passport: f.passport, currentBoundary: { ...boundary, authorityGrantDigest: sha256('other-grant') }, inputClassDigest }), 'AUTHORITY_DRIFT');
  assert.equal(detectShortcutDriftV33_15({ passport: f.passport, currentBoundary: { ...boundary, allowedScopes: ['repository:read'] }, inputClassDigest }), 'SCOPE_DRIFT');
  assert.equal(detectShortcutDriftV33_15({ passport: f.passport, currentBoundary: { ...boundary, policyDigest: sha256('other-policy') }, inputClassDigest }), 'POLICY_DRIFT');
  assert.equal(detectShortcutDriftV33_15({ passport: f.passport, currentBoundary: { ...boundary, inputSchemaDigest: sha256('other-schema') }, inputClassDigest }), 'INPUT_SCHEMA_DRIFT');
  assert.equal(detectShortcutDriftV33_15({ passport: f.passport, currentBoundary: { ...boundary, toolchainDigest: sha256('other-tools') }, inputClassDigest }), 'TOOLCHAIN_DRIFT');
  assert.equal(detectShortcutDriftV33_15({ passport: f.passport, currentBoundary: { ...boundary, modelSetDigest: sha256('other-models') }, inputClassDigest }), 'MODEL_SET_DRIFT');
  assert.equal(detectShortcutDriftV33_15({ passport: f.passport, currentBoundary: boundary, inputClassDigest, observedShortcutResultDigest: sha256('wrong-result') }), 'RESULT_MISMATCH');
});

test('any boundary drift, high risk or non-reversible work falls back to full workflow', () => {
  const f = qualifiedFixture();
  const base = { passport: f.passport, passportRegistry: registry(f.passportIssuer), trustedPassportIssuerIds: [f.passportIssuer.keyId], activation: f.activation, activationRegistry: registry(f.activator), trustedActivationSignerIds: [f.activator.keyId], inputClassDigest, now };
  assert.equal(routeAdaptiveExecutionV33_15({ ...base, currentBoundary: { ...boundary, policyDigest: sha256('drift') } }).route, 'FULL_GOVERNED_WORKFLOW');
  assert.equal(routeAdaptiveExecutionV33_15({ ...base, currentBoundary: { ...boundary, riskClass: 'critical' } }).reason, 'RISK_TOO_HIGH');
  assert.equal(routeAdaptiveExecutionV33_15({ ...base, currentBoundary: { ...boundary, reversible: false } }).reason, 'NOT_REVERSIBLE');
});

test('valid revocation forces fallback and untrusted revocation does not qualify as a valid signed revocation', () => {
  const f = qualifiedFixture();
  const revocation = createShortcutRevocationV33_15({ passport: f.passport, reason: 'RESULT_MISMATCH', evidence: { mismatch: true }, signer: f.revoker, now });
  const base = { passport: f.passport, passportRegistry: registry(f.passportIssuer), trustedPassportIssuerIds: [f.passportIssuer.keyId], activation: f.activation, activationRegistry: registry(f.activator), trustedActivationSignerIds: [f.activator.keyId], currentBoundary: boundary, inputClassDigest, revocations: [revocation], revocationRegistry: registry(f.revoker), now };
  assert.equal(routeAdaptiveExecutionV33_15({ ...base, trustedRevocationSignerIds: [f.revoker.keyId] }).reason, 'REVOKED');
  assert.equal(routeAdaptiveExecutionV33_15({ ...base, trustedRevocationSignerIds: ['untrusted'] }).route, 'QUALIFIED_SHORTCUT_SHADOW');
});

test('missing revocation trust context fails closed when revocation evidence exists', () => {
  const f = qualifiedFixture();
  const revocation = createShortcutRevocationV33_15({ passport: f.passport, reason: 'MANUAL_REVOCATION', evidence: { operator: 'admin' }, signer: f.revoker, now });
  const decision = routeAdaptiveExecutionV33_15({ passport: f.passport, passportRegistry: registry(f.passportIssuer), trustedPassportIssuerIds: [f.passportIssuer.keyId], activation: f.activation, activationRegistry: registry(f.activator), trustedActivationSignerIds: [f.activator.keyId], currentBoundary: boundary, inputClassDigest, revocations: [revocation], now });
  assert.equal(decision.reason, 'REVOKED');
});

test('expired passport and expired activation fall back to full workflow', () => {
  const f = qualifiedFixture();
  const afterActivation = new Date(Date.parse(activationExpiry) + 1);
  const decision = routeAdaptiveExecutionV33_15({ passport: f.passport, passportRegistry: registry(f.passportIssuer), trustedPassportIssuerIds: [f.passportIssuer.keyId], activation: f.activation, activationRegistry: registry(f.activator), trustedActivationSignerIds: [f.activator.keyId], currentBoundary: boundary, inputClassDigest, now: afterActivation });
  assert.equal(decision.reason, 'ACTIVATION_INVALID');
  const afterPassport = new Date(Date.parse(passportExpiry) + 1);
  const expired = routeAdaptiveExecutionV33_15({ passport: f.passport, passportRegistry: registry(f.passportIssuer), trustedPassportIssuerIds: [f.passportIssuer.keyId], activation: f.activation, activationRegistry: registry(f.activator), trustedActivationSignerIds: [f.activator.keyId], currentBoundary: boundary, inputClassDigest, now: afterPassport });
  assert.equal(expired.reason, 'EXPIRED');
});

test('forged activation signature cannot enable shortcut', () => {
  const f = qualifiedFixture();
  const forgedPayload = { ...f.activation.payload, approvedBy: 'attacker' };
  const forged = signEnvelope(forgedPayload, generateSigningIdentity('attacker'));
  const decision = routeAdaptiveExecutionV33_15({ passport: f.passport, passportRegistry: registry(f.passportIssuer), trustedPassportIssuerIds: [f.passportIssuer.keyId], activation: forged, activationRegistry: registry(f.activator), trustedActivationSignerIds: [f.activator.keyId], currentBoundary: boundary, inputClassDigest, now });
  assert.equal(decision.reason, 'ACTIVATION_INVALID');
});
