import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { ReviewerTrustRegistry } from '../src/security/reviewer-trust.js';
import { registerReviewerFixture, reviewerAttestation } from './reviewer-fixtures.js';
import { registerCredentialIssuerFixture } from './credential-issuer-fixtures.js';
import type { GovernedDeliberationPacket, NamespacedWorkNode } from '../src/ai/governed-deliberation.js';
import {
  FileCampaignStore, GovernedCampaignTracker, GovernedEngineeringCampaignPlanner,
  type CampaignItemResult, type CampaignPolicy,
} from '../src/product/engineering-campaign.js';

const now = new Date('2026-07-17T16:00:00.000Z');
function setup() {
  const deliberationSigner = generateSigningIdentity('deliberation-plan'); const campaignSigner = generateSigningIdentity('campaign-plan'); const reviewerA = generateSigningIdentity('reviewer-a'); const reviewerB = generateSigningIdentity('reviewer-b'); const credentialIssuer = generateSigningIdentity('reviewer-credential-issuer'); const credentialRoot = generateSigningIdentity('reviewer-credential-root'); const registry = new KeyRegistry();
  for (const signer of [deliberationSigner, campaignSigner, reviewerA, reviewerB, credentialIssuer, credentialRoot]) registry.register(signer.keyId, signer.publicKey);
  const issuerFixture = registerCredentialIssuerFixture({ registry, root: credentialRoot, issuer: credentialIssuer, kinds: ['REVIEWER'], tenantIds: ['tenant-1'], scopes: ['campaign.review'], now });
  const reviewerTrust = new ReviewerTrustRegistry(registry, issuerFixture.trust, () => now);
  const reviewerAProfile = registerReviewerFixture({ registry, trust: reviewerTrust, issuer: credentialIssuer, signer: reviewerA, organizationId: 'org-a', now });
  const reviewerBProfile = registerReviewerFixture({ registry, trust: reviewerTrust, issuer: credentialIssuer, signer: reviewerB, organizationId: 'org-b', now });
  const root = mkdtempSync(join(tmpdir(), 'campaign-v30-')); const store = new FileCampaignStore(root); const planner = new GovernedEngineeringCampaignPlanner(registry, campaignSigner, store);
  return { registry, reviewerTrust, credentialIssuer, deliberationSigner, campaignSigner, reviewerA, reviewerB, reviewerAProfile, reviewerBProfile, root, store, planner, tracker: new GovernedCampaignTracker(registry, reviewerTrust, store) };
}
function node(id: string, kind: NamespacedWorkNode['kind'], patch: Partial<NamespacedWorkNode> = {}): NamespacedWorkNode {
  return { nodeId: id, role: 'ARCHITECTURE', perspectiveId: 'p', sourceRequestId: 'r', kind, summary: id, dependsOn: [], payload: { userValue: 8, riskReduction: 8, effort: 3, complexity: 3 }, ...patch };
}
function packet(nodes: readonly NamespacedWorkNode[], patch: Partial<GovernedDeliberationPacket> = {}): GovernedDeliberationPacket {
  const material = {
    packetId: 'packet', deliberationId: 'delib', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', perspectiveCount: 3,
    roleCoverage: ['ARCHITECTURE','SECURITY','TEST'] as const, missingRoles: [] as const, receiptDigests: [sha256('r1')], supportedClaims: ['c'], unsupportedClaims: [], hypotheses: [], conflicts: [], workNodes: nodes,
    workKindCoverage: [...new Set(nodes.map((item) => item.kind))].sort(), toolCoverage: [] as const, aggregateUsage: { inputChars: 10, outputChars: 10, latencyMs: 10 }, synthesisState: 'READY_FOR_CAMPAIGN' as const,
    executionState: 'REVIEW_REQUIRED' as const, promotionCeiling: 'research' as const, externalInteractionsExecuted: 0, externalMutationsExecuted: 0 as const, externalEffectsExecuted: 0 as const, generatedAt: now.toISOString(), limitations: ['review-required'],
    evidence: { recordId: 'e', tenantId: 'tenant-1', kind: 'd', subject: 'repo:alpha', payload: {}, evidenceClass: 'COMPUTED' as const, method: 'test', environment: {}, createdAt: now.toISOString(), limitations: [] },
    ...patch,
  };
  return { ...material, packetDigest: sha256(material) };
}
const policy: CampaignPolicy = { maxItems: 10, maxTotalEffort: 30, maxParallelism: 2, minimumScore: 0, requiredProofKinds: ['TEST','MUTATION','REVIEW','ROLLBACK'], forbiddenTools: ['secret.read'] };

test('planner prioritizes high-value work, preserves dependencies and stages', () => {
  const h = setup(); const analysis = node('analysis', 'ANALYSIS'); const tests = node('tests', 'TEST_PROPOSAL', { role: 'TEST', dependsOn: ['analysis'], requestedTool: 'tests.propose', payload: { userValue: 9, riskReduction: 10, effort: 2, complexity: 2 } });
  const change = node('change', 'CHANGE_PROPOSAL', { dependsOn: ['tests'], requestedTool: 'change.propose', payload: { userValue: 10, riskReduction: 9, effort: 5, complexity: 5 } });
  const signed = h.planner.plan({ campaignId: 'campaign-1', deliberation: signEnvelope(packet([analysis, tests, change]), h.deliberationSigner), policy, generatedAt: now.toISOString() });
  assert.equal(h.registry.verify(signed), true); assert.equal(signed.payload.items.length, 3); assert.equal(signed.payload.stages.length, 3);
  assert.equal(signed.payload.nextPermittedItemIds.length, 1); assert.ok(signed.payload.proofCoverage.includes('MUTATION')); assert.equal(signed.payload.externalInteractionsExecuted, 0); assert.equal(signed.payload.externalMutationsExecuted, 0); assert.equal(signed.payload.externalEffectsExecuted, 0);
});

test('planner enforces score, effort, item and forbidden-tool budgets', () => {
  const h = setup(); const low = node('low','ANALYSIS',{ payload:{ userValue:0,riskReduction:0,reuse:0,evidenceUrgency:0,effort:10,complexity:10 } });
  const expensive = node('expensive','CHANGE_PROPOSAL',{ requestedTool:'change.propose',payload:{userValue:10,riskReduction:10,effort:10,complexity:1} });
  const forbidden = node('forbidden','ANALYSIS',{ requestedTool:'repository.read',payload:{userValue:10,riskReduction:10,effort:1,complexity:1} });
  const signed=h.planner.plan({campaignId:'campaign-budget',deliberation:signEnvelope(packet([low,expensive,forbidden]),h.deliberationSigner),policy:{...policy,minimumScore:20,maxTotalEffort:5,maxItems:1,forbiddenTools:['repository.read']},generatedAt:now.toISOString()});
  const reasons=signed.payload.excluded.map((row)=>row.reason); assert.ok(reasons.includes('BELOW_MINIMUM_SCORE')); assert.ok(reasons.includes('EFFORT_BUDGET')); assert.ok(reasons.includes('FORBIDDEN_TOOL'));
});

test('planner rejects incomplete role coverage, invalid signature and invalid policy', () => {
  const h=setup(); const valid=signEnvelope(packet([node('a','ANALYSIS')]),h.deliberationSigner); const rogue=generateSigningIdentity('rogue');
  assert.throws(()=>h.planner.plan({campaignId:'x',deliberation:signEnvelope(valid.payload,rogue),policy,generatedAt:now.toISOString()}),/signature_invalid/);
  assert.throws(()=>h.planner.plan({campaignId:'x',deliberation:signEnvelope(packet([node('a','ANALYSIS')],{synthesisState:'ROLE_COVERAGE_INCOMPLETE'}),h.deliberationSigner),policy,generatedAt:now.toISOString()}),/role_coverage_incomplete/);
  assert.throws(()=>h.planner.plan({campaignId:'x',deliberation:valid,policy:{...policy,maxParallelism:0},generatedAt:now.toISOString()}),/policy_invalid/);
});

test('plan is idempotent across restart and conflicts on changed policy', () => {
  const h=setup(); const deliberation=signEnvelope(packet([node('a','ANALYSIS')]),h.deliberationSigner); const first=h.planner.plan({campaignId:'campaign-restart',deliberation,policy,generatedAt:now.toISOString()});
  const reopened=new GovernedEngineeringCampaignPlanner(h.registry,h.campaignSigner,new FileCampaignStore(h.root)); const second=reopened.plan({campaignId:'campaign-restart',deliberation,policy,generatedAt:now.toISOString()});
  assert.equal(sha256(first),sha256(second)); assert.throws(()=>reopened.plan({campaignId:'campaign-restart',deliberation,policy:{...policy,maxItems:9},generatedAt:now.toISOString()}),/plan_conflict/);
});

test('tracker unlocks dependency work only after evidence-backed dual-reviewed success', () => {
  const h=setup(); const a=node('a','ANALYSIS'); const b=node('b','TEST_PROPOSAL',{dependsOn:['a'],role:'TEST',requestedTool:'tests.propose'}); const signed=h.planner.plan({campaignId:'campaign-track',deliberation:signEnvelope(packet([a,b]),h.deliberationSigner),policy,generatedAt:now.toISOString()});
  const first=signed.payload.items.find((item)=>item.sourceNodeId==='a')!; const second=signed.payload.items.find((item)=>item.sourceNodeId==='b')!;
  const result=(itemId:string,patch:Partial<CampaignItemResult>={}):CampaignItemResult=>{ const evidenceRefs=['evidence:test']; const evidenceDigest=sha256(evidenceRefs); return {resultId:`result:${itemId}`,campaignId:'campaign-track',itemId,status:'SUCCEEDED',evidenceRefs,reviewerAttestations:[reviewerAttestation({fixture:h.reviewerAProfile,campaignId:'campaign-track',itemId,status:'SUCCEEDED',evidenceDigest,reviewedAt:now.toISOString()}),reviewerAttestation({fixture:h.reviewerBProfile,campaignId:'campaign-track',itemId,status:'SUCCEEDED',evidenceDigest,reviewedAt:now.toISOString()})],actualEffort:2,completedAt:now.toISOString(),limitations:[],...patch}; };
  assert.throws(()=>h.tracker.record('campaign-track',result(second.itemId)),/dependency_not_satisfied/);
  const snap=h.tracker.record('campaign-track',result(first.itemId)); assert.deepEqual(snap.nextPermittedItemIds,[second.itemId]); assert.equal(snap.progressPercent,50);
  const done=h.tracker.record('campaign-track',result(second.itemId)); assert.equal(done.campaignState,'COMPLETED'); assert.equal(done.progressPercent,100);
});

test('tracker rejects missing evidence, self-like review count and result substitution', () => {
  const h=setup(); const signed=h.planner.plan({campaignId:'campaign-errors',deliberation:signEnvelope(packet([node('a','ANALYSIS')]),h.deliberationSigner),policy,generatedAt:now.toISOString()}); const item=signed.payload.items[0]!;
  const evidenceRefs=['e']; const evidenceDigest=sha256(evidenceRefs); const attestations=[reviewerAttestation({fixture:h.reviewerAProfile,campaignId:'campaign-errors',itemId:item.itemId,status:'SUCCEEDED',evidenceDigest,reviewedAt:now.toISOString()}),reviewerAttestation({fixture:h.reviewerBProfile,campaignId:'campaign-errors',itemId:item.itemId,status:'SUCCEEDED',evidenceDigest,reviewedAt:now.toISOString()})];
  const base:CampaignItemResult={resultId:'result',campaignId:'campaign-errors',itemId:item.itemId,status:'SUCCEEDED',evidenceRefs,reviewerAttestations:attestations,actualEffort:1,completedAt:now.toISOString(),limitations:[]};
  assert.throws(()=>h.tracker.record('campaign-errors',{...base,evidenceRefs:[]}),/evidence_required/); assert.throws(()=>h.tracker.record('campaign-errors',{...base,reviewerAttestations:[attestations[0]!]}),/dual_review/);
  h.tracker.record('campaign-errors',base); assert.throws(()=>h.tracker.record('campaign-errors',{...base,actualEffort:2}),/result_conflict/);
});

test('file campaign store detects plan and snapshot tamper', () => {
  const h=setup(); h.planner.plan({campaignId:'campaign-tamper',deliberation:signEnvelope(packet([node('a','ANALYSIS')]),h.deliberationSigner),policy,generatedAt:now.toISOString()});
  const stateFile=join(h.root,readdirSync(h.root).find((name)=>name.startsWith('state-'))!); const row=JSON.parse(readFileSync(stateFile,'utf8')); row.progressPercent=99; writeFileSync(stateFile,JSON.stringify(row));
  assert.throws(()=>new FileCampaignStore(h.root).getSnapshot('campaign-tamper'),/snapshot_tampered/);
});
