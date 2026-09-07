import { mkdirSync, writeFileSync } from 'node:fs';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../dist/src/contracts/crypto.js';
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
} from '../dist/src/runtime/proof-carrying-adaptive-execution-v33_15.js';

const out = 'release-evidence/v33.15';
mkdirSync(out, { recursive: true });
const now = new Date('2026-07-21T15:30:00.000Z');
const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
const activationExpiry = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
const boundary = {
  tenantId: 'tenant-proof-v33.15',
  workflowType: 'dependency-patch-update-no-api-change',
  authorityGrantDigest: sha256('authority-grant-v33.15'),
  allowedScopes: ['repository:read', 'repository:shadow-change'],
  policyDigest: sha256('policy-v33.15'),
  inputSchemaDigest: sha256('schema-v33.15'),
  toolchainDigest: sha256('toolchain-v33.15'),
  modelSetDigest: sha256('model-set-v33.15'),
  riskClass: 'low',
  reversible: true,
};
const inputClassDigest = sha256('patch-update-no-api-change');
const resultDigest = sha256('reviewed-equivalent-output');
function obs(id, evidenceClass, index) {
  return createWorkflowObservationV33_15({
    observationId: id,
    evidenceClass,
    boundary,
    inputClassDigest,
    fullWorkflowResultDigest: resultDigest,
    fullWorkflowEvidenceRoot: sha256({ id, evidence: 'full-governed-workflow' }),
    fullWorkflowPassed: true,
    userDecision: 'APPROVED',
    userSteps: 10,
    approvalCount: 1,
    costUnits: 12 + (index % 2),
    durationMs: 1200 + index * 10,
    observedAt: new Date(now.getTime() - (100 - index) * 60_000).toISOString(),
    externalEffectsExecuted: 0,
  });
}
const training = Array.from({ length: 8 }, (_, i) => obs(`training-${i}`, 'TRAINING', i));
const holdout = Array.from({ length: 4 }, (_, i) => obs(`holdout-${i}`, 'HOLDOUT', i + 10));
const shadow = Array.from({ length: 10 }, (_, i) => obs(`shadow-${i}`, 'SHADOW', i + 20));
const candidate = discoverShortcutCandidateV33_15({ observations: training, minimumTrainingCount: 8, minimumHoldoutCount: 4, minimumShadowCount: 10, now });
const qualifier = generateSigningIdentity('v33.15-independent-qualifier');
const issuer = generateSigningIdentity('v33.15-passport-issuer');
const activator = generateSigningIdentity('v33.15-user-activator');
const revoker = generateSigningIdentity('v33.15-drift-revoker');
const proofSigner = generateSigningIdentity('v33.15-proof-signer');
function keys(...ids) { const r = new KeyRegistry(); for (const id of ids) r.register(id.keyId, id.publicKey); return r; }
const qualification = qualifyShortcutCandidateV33_15({ candidate, holdoutObservations: holdout, qualifier, now });
const qualificationVerified = verifyShortcutQualificationV33_15({ envelope: qualification, registry: keys(qualifier), expectedCandidateDigest: candidate.candidateDigest, trustedSignerIds: [qualifier.keyId] });
const comparisons = shadow.map((observation) => compareShadowExecutionV33_15({ candidate, observation, shortcutResultDigest: resultDigest, now }));
const passport = issueShortcutPassportV33_15({ candidate, qualification, qualificationRegistry: keys(qualifier), trustedQualifierIds: [qualifier.keyId], comparisons, issuer, expiresAt: expiry, now });
const passportVerified = verifyShortcutPassportV33_15({ envelope: passport, registry: keys(issuer), trustedIssuerIds: [issuer.keyId], now });
const activation = activateShortcutPassportV33_15({ passport, passportRegistry: keys(issuer), trustedPassportIssuerIds: [issuer.keyId], approvedBy: 'human-owner-v33.15', approvedScopes: boundary.allowedScopes, signer: activator, expiresAt: activationExpiry, now });
const routing = Array.from({ length: 12 }, (_, i) => routeAdaptiveExecutionV33_15({ passport, passportRegistry: keys(issuer), trustedPassportIssuerIds: [issuer.keyId], activation, activationRegistry: keys(activator), trustedActivationSignerIds: [activator.keyId], currentBoundary: boundary, inputClassDigest, now: new Date(now.getTime() + i * 1000) }));
const driftBoundary = { ...boundary, toolchainDigest: sha256('toolchain-v33.15-drifted') };
const driftReason = detectShortcutDriftV33_15({ passport, currentBoundary: driftBoundary, inputClassDigest });
const revocation = createShortcutRevocationV33_15({ passport, reason: driftReason ?? 'MANUAL_REVOCATION', evidence: { driftBoundaryDigest: sha256(driftBoundary) }, signer: revoker, now: new Date(now.getTime() + 20_000) });
const postDriftDecision = routeAdaptiveExecutionV33_15({ passport, passportRegistry: keys(issuer), trustedPassportIssuerIds: [issuer.keyId], activation, activationRegistry: keys(activator), trustedActivationSignerIds: [activator.keyId], currentBoundary: driftBoundary, inputClassDigest, revocations: [revocation], revocationRegistry: keys(revoker), trustedRevocationSignerIds: [revoker.keyId], now: new Date(now.getTime() + 21_000) });
const fullCost = shadow.reduce((sum, item) => sum + item.costUnits, 0);
const fullDuration = shadow.reduce((sum, item) => sum + item.durationMs, 0);
const fullSteps = shadow.reduce((sum, item) => sum + item.userSteps, 0);
const projectedShortcutCost = shadow.length * 3;
const projectedShortcutDuration = shadow.length * 250;
const projectedShortcutSteps = shadow.length * 1;
const metric = (before, after) => Number((((before - after) / before) * 100).toFixed(2));
const trace = {
  version: '33.15',
  evidenceClass: 'SIMULATED_LOCAL_SHADOW_CAMPAIGN',
  trainingObservationDigests: training.map((x) => x.observationDigest),
  holdoutObservationDigests: holdout.map((x) => x.observationDigest),
  shadowComparisonDigests: comparisons.map((x) => x.comparisonDigest),
  candidateDigest: candidate.candidateDigest,
  qualificationDigest: qualification.payload.qualificationDigest,
  passportDigest: passport.payload.passportDigest,
  activationDigest: activation.payload.activationDigest,
  revocationDigest: revocation.payload.revocationDigest,
  routingDecisionDigests: routing.map((x) => x.decisionDigest),
  postDriftDecisionDigest: postDriftDecision.decisionDigest,
  traceDigest: '',
};
{ const { traceDigest: _traceDigest, ...traceMaterial } = trace; trace.traceDigest = sha256(traceMaterial); }
const proofMaterial = {
  version: '33.15',
  status: 'LOCAL_SHADOW_SHORTCUT_QUALIFIED_AND_DRIFT_REVOKED',
  evidenceClass: 'SIMULATED_LOCAL_SHADOW_CAMPAIGN',
  candidateVerified: true,
  qualificationVerified,
  passportVerified,
  trainingCount: training.length,
  holdoutCount: holdout.length,
  shadowCount: comparisons.length,
  shadowMismatchCount: comparisons.filter((x) => !x.match).length,
  qualifiedRoutingCount: routing.filter((x) => x.route === 'QUALIFIED_SHORTCUT_SHADOW').length,
  authorityExpansionCount: routing.filter((x) => x.authorityExpanded).length,
  externalEffectsExecuted: routing.reduce((sum, x) => sum + x.externalEffectsExecuted, 0),
  explicitActivationRequired: passport.payload.requiresExplicitActivation,
  promotionCeiling: passport.payload.promotionCeiling,
  driftReason,
  postDriftRoute: postDriftDecision.route,
  postDriftReason: postDriftDecision.reason,
  fallbackRoute: passport.payload.fallbackRoute,
  simulatedBenefit: {
    fullCostUnits: fullCost,
    projectedShortcutCostUnits: projectedShortcutCost,
    costReductionPercent: metric(fullCost, projectedShortcutCost),
    fullDurationMs: fullDuration,
    projectedShortcutDurationMs: projectedShortcutDuration,
    durationReductionPercent: metric(fullDuration, projectedShortcutDuration),
    fullUserSteps: fullSteps,
    projectedShortcutUserSteps: projectedShortcutSteps,
    userStepReductionPercent: metric(fullSteps, projectedShortcutSteps),
  },
  limitations: [
    'SIMULATED_LOCAL_SHADOW_CAMPAIGN_NOT_EXTERNAL_OR_CUSTOMER_EVIDENCE',
    'SHORTCUT_ROUTE_DOES_NOT_EXECUTE_EXTERNAL_EFFECTS',
    'BENEFIT_ESTIMATE_IS_STRUCTURAL_NOT_HUMAN_OR_PRODUCTION_MEASUREMENT',
    'ONE_WORKFLOW_CLASS_ONLY',
    'NO_LIVE_DRIFT_MONITOR_SERVICE',
    'NO_PRODUCTION_PROMOTION',
  ],
  productionPromotion: 'blocked',
  proofDigest: '',
};
{ const { proofDigest: _proofDigest, ...proofMaterialWithoutDigest } = proofMaterial; proofMaterial.proofDigest = sha256(proofMaterialWithoutDigest); }
const signedProof = signEnvelope(proofMaterial, proofSigner);
const proofKeys = keys(proofSigner);
const proofEnvelope = { signedProof, publicKey: proofKeys.exportPublicKey(proofSigner.keyId) };
writeFileSync(`${out}/V33_15_ADAPTIVE_EXECUTION_TRACE.json`, JSON.stringify(trace, null, 2) + '\n');
writeFileSync(`${out}/V33_15_PROOF_CARRYING_ADAPTIVE_EXECUTION_PROOF.json`, JSON.stringify({ ...proofMaterial, proofEnvelope }, null, 2) + '\n');
console.log(JSON.stringify(proofMaterial, null, 2));
if (!qualificationVerified || !passportVerified || proofMaterial.shadowMismatchCount !== 0 || proofMaterial.qualifiedRoutingCount !== 12 || proofMaterial.authorityExpansionCount !== 0 || proofMaterial.externalEffectsExecuted !== 0 || driftReason !== 'TOOLCHAIN_DRIFT' || postDriftDecision.route !== 'FULL_GOVERNED_WORKFLOW' || postDriftDecision.reason !== 'REVOKED') process.exit(1);
