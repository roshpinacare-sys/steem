import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import type { GovernedDeliberationPacket, NamespacedWorkNode } from '../src/ai/governed-deliberation.js';
import {
  GovernedCampaignTracker, GovernedEngineeringCampaignPlanner, InMemoryCampaignStore,
  type CampaignItemResult, type CampaignPolicy,
} from '../src/product/engineering-campaign.js';
import { ReviewerTrustRegistry, type ReviewerRole } from '../src/security/reviewer-trust.js';
import { registerReviewerFixture, reviewerAttestation, type ReviewerFixture } from './reviewer-fixtures.js';
import { registerCredentialIssuerFixture } from './credential-issuer-fixtures.js';

const now = new Date('2026-07-17T23:00:00.000Z');
const policy: CampaignPolicy = { maxItems: 3, maxTotalEffort: 10, maxParallelism: 1, minimumScore: 0, requiredProofKinds: ['REVIEW'], forbiddenTools: [] };
function work(): NamespacedWorkNode { return { nodeId: 'review-target', role: 'ARCHITECTURE', perspectiveId: 'p', sourceRequestId: 'r', kind: 'ANALYSIS', summary: 'review target', dependsOn: [], payload: {} }; }
function packet(requesterId: string): GovernedDeliberationPacket {
  const material = { packetId: 'review-packet', deliberationId: 'review-delib', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId, perspectiveCount: 2, roleCoverage: ['ARCHITECTURE','SECURITY'] as const, missingRoles: [] as const, receiptDigests: ['r'], supportedClaims: [], unsupportedClaims: [], hypotheses: [], conflicts: [], workNodes: [work()], workKindCoverage: ['ANALYSIS'] as const, toolCoverage: [] as const, aggregateUsage: { inputChars: 1, outputChars: 1, latencyMs: 1 }, synthesisState: 'READY_FOR_CAMPAIGN' as const, executionState: 'REVIEW_REQUIRED' as const, promotionCeiling: 'research' as const, externalInteractionsExecuted: 0, externalMutationsExecuted: 0 as const, externalEffectsExecuted: 0 as const, generatedAt: now.toISOString(), limitations: [], evidence: { recordId: 'e', tenantId: 'tenant-1', kind: 'review', subject: 'repo:alpha', payload: {}, evidenceClass: 'COMPUTED' as const, method: 'test', environment: {}, createdAt: now.toISOString(), limitations: [] } };
  return { ...material, packetDigest: sha256(material) };
}
function setup(input: { requesterId?: string; orgA?: string; orgB?: string; tenantA?: string; tenantB?: string; roleA?: ReviewerRole; roleB?: ReviewerRole; scopeA?: string; scopeB?: string; revokeA?: boolean } = {}) {
  const deliberation = generateSigningIdentity('review-deliberation'); const campaign = generateSigningIdentity('review-campaign'); const issuer = generateSigningIdentity('review-issuer'); const credentialRoot = generateSigningIdentity('review-root'); const reviewerA = generateSigningIdentity('reviewer-a-v31'); const reviewerB = generateSigningIdentity('reviewer-b-v31'); const registry = new KeyRegistry();
  for (const signer of [deliberation, campaign, issuer, credentialRoot, reviewerA, reviewerB]) registry.register(signer.keyId, signer.publicKey);
  const issuerFixture = registerCredentialIssuerFixture({ registry, root: credentialRoot, issuer, kinds: ['REVIEWER'], tenantIds: ['tenant-1','tenant-2'], scopes: ['campaign.review','other.scope'], now });
  const trust = new ReviewerTrustRegistry(registry, issuerFixture.trust, () => now);
  const a = registerReviewerFixture({ registry, trust, issuer, signer: reviewerA, organizationId: input.orgA ?? 'org-a', tenantId: input.tenantA ?? 'tenant-1', now, ...(input.roleA === undefined ? {} : { role: input.roleA }), ...(input.scopeA === undefined ? {} : { scope: input.scopeA }), ...(input.revokeA ? { revokedAt: now.toISOString() } : {}) });
  const b = registerReviewerFixture({ registry, trust, issuer, signer: reviewerB, organizationId: input.orgB ?? 'org-b', tenantId: input.tenantB ?? 'tenant-1', now, ...(input.roleB === undefined ? {} : { role: input.roleB }), ...(input.scopeB === undefined ? {} : { scope: input.scopeB }) });
  const store = new InMemoryCampaignStore(); const planner = new GovernedEngineeringCampaignPlanner(registry, campaign, store); const requesterId = input.requesterId ?? 'operator';
  const plan = planner.plan({ campaignId: 'review-campaign-1', deliberation: signEnvelope(packet(requesterId), deliberation), policy, generatedAt: now.toISOString() });
  return { registry, trust, store, planner, tracker: new GovernedCampaignTracker(registry, trust, store), plan, campaign, issuer, reviewerA, reviewerB, a, b };
}
function result(h: ReturnType<typeof setup>, reviewers: readonly ReviewerFixture[] = [h.a, h.b]): CampaignItemResult {
  const item = h.plan.payload.items[0]!; const evidenceRefs = ['evidence:reviewed']; const evidenceDigest = sha256(evidenceRefs);
  return { resultId: 'review-result', campaignId: h.plan.payload.campaignId, itemId: item.itemId, status: 'SUCCEEDED', evidenceRefs, reviewerAttestations: reviewers.map((fixture) => reviewerAttestation({ fixture, campaignId: h.plan.payload.campaignId, itemId: item.itemId, status: 'SUCCEEDED', evidenceDigest, reviewedAt: now.toISOString() })), actualEffort: 1, completedAt: now.toISOString(), limitations: [] };
}

test('two credentialed reviewers from distinct organizations satisfy independent review', () => {
  const h = setup(); const snapshot = h.tracker.record(h.plan.payload.campaignId, result(h)); assert.equal(snapshot.campaignState, 'COMPLETED');
});

test('different reviewer keys from the same organization do not satisfy independence', () => {
  const h = setup({ orgA: 'same-org', orgB: 'same-org' }); assert.throws(() => h.tracker.record(h.plan.payload.campaignId, result(h)), /independent_organization_required/);
});

test('reviewer credential must authorize tenant, scope and role and remain active', () => {
  const wrongTenant = setup({ tenantA: 'tenant-2' }); assert.throws(() => wrongTenant.tracker.record(wrongTenant.plan.payload.campaignId, result(wrongTenant)), /reviewer_not_authorized/);
  const wrongScope = setup({ scopeA: 'other.scope' }); assert.throws(() => wrongScope.tracker.record(wrongScope.plan.payload.campaignId, result(wrongScope)), /reviewer_not_authorized/);
  const wrongRole = setup({ roleA: 'SECURITY_REVIEWER' }); const malformed = result(wrongRole); const first = malformed.reviewerAttestations[0]!; const changed = signEnvelope({ ...first.payload, reviewerRole: 'INDEPENDENT_REVIEWER' as const }, wrongRole.reviewerA); assert.throws(() => wrongRole.tracker.record(wrongRole.plan.payload.campaignId, { ...malformed, reviewerAttestations: [changed, malformed.reviewerAttestations[1]!] }), /reviewer_not_authorized/);
  const revoked = setup({ revokeA: true }); assert.throws(() => revoked.tracker.record(revoked.plan.payload.campaignId, result(revoked)), /credential_inactive/);
});

test('requester and campaign plan signer cannot approve their own campaign result', () => {
  const requester = setup({ requesterId: 'reviewer-a-v31' }); assert.throws(() => requester.tracker.record(requester.plan.payload.campaignId, result(requester)), /conflict_of_interest/);
  const h = setup(); const campaignReviewer = registerReviewerFixture({ registry: h.registry, trust: h.trust, issuer: h.issuer, signer: h.campaign, organizationId: 'campaign-org', now });
  assert.throws(() => h.tracker.record(h.plan.payload.campaignId, result(h, [campaignReviewer, h.b])), /conflict_of_interest/);
});

test('attestation organization and credential digest are bound to the credential', () => {
  const h = setup(); const valid = result(h); const first = valid.reviewerAttestations[0]!;
  const wrongOrg = signEnvelope({ ...first.payload, reviewerOrganizationId: 'invented-org' }, h.reviewerA);
  assert.throws(() => h.tracker.record(h.plan.payload.campaignId, { ...valid, reviewerAttestations: [wrongOrg, valid.reviewerAttestations[1]!] }), /credential_binding_invalid/);
  const wrongDigest = signEnvelope({ ...first.payload, reviewerCredentialDigest: sha256('other') }, h.reviewerA);
  assert.throws(() => h.tracker.record(h.plan.payload.campaignId, { ...valid, reviewerAttestations: [wrongDigest, valid.reviewerAttestations[1]!] }), /credential_binding_invalid/);
});

test('uncredentialed reviewer key and forged credential are rejected', () => {
  const h = setup(); const rogue = generateSigningIdentity('uncredentialed-reviewer'); h.registry.register(rogue.keyId, rogue.publicKey); const valid = result(h); const first = valid.reviewerAttestations[0]!;
  const rogueAttestation = signEnvelope({ ...first.payload, reviewerId: rogue.keyId }, rogue);
  assert.throws(() => h.tracker.record(h.plan.payload.campaignId, { ...valid, reviewerAttestations: [rogueAttestation, valid.reviewerAttestations[1]!] }), /reviewer_not_credentialed/);
  const rogueIssuer = generateSigningIdentity('rogue-issuer'); h.registry.register(rogueIssuer.keyId, rogueIssuer.publicKey);
  const forged = signEnvelope({ ...h.a.credential.payload, issuerId: rogueIssuer.keyId }, rogueIssuer);
  assert.throws(() => h.trust.register(forged), /credential_conflict|issuer_mismatch|credential_issuer_not_authorized|issuer_grant_binding_invalid/);
});

test('signed reviewer credential revocation is credential-bound, issuer-authorized and time-effective', () => {
  const h = setup(); const revocation = signEnvelope({ revocationId: 'revoke-reviewer-a', reviewerKeyId: h.reviewerA.keyId, credentialDigest: h.a.credentialDigest, reason: 'independence-compromised', revokedAt: now.toISOString(), issuerId: h.issuer.keyId }, h.issuer);
  h.trust.registerRevocation(revocation);
  assert.throws(() => h.tracker.record(h.plan.payload.campaignId, result(h)), /credential_revoked/);
  h.trust.registerRevocation(revocation);
  const rogue = generateSigningIdentity('rogue-revoker'); h.registry.register(rogue.keyId, rogue.publicKey);
  const forged = signEnvelope({ ...revocation.payload, revocationId: 'forged', issuerId: rogue.keyId }, rogue);
  assert.throws(() => h.trust.registerRevocation(forged), /issuer_not_authorized|issuer_mismatch/);
  const substituted = signEnvelope({ ...revocation.payload, credentialDigest: sha256('other') }, h.issuer);
  assert.throws(() => h.trust.registerRevocation(substituted), /credential_binding_invalid/);
});
