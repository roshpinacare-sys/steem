import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { GovernedProductCompletionCoordinator, type GovernedProductCompletionRequest } from '../src/app/governed-product-completion.js';
import type { GovernedDeliberationPacket } from '../src/ai/governed-deliberation.js';
import type { GovernedEngineeringCampaign, CampaignWorkItem } from '../src/product/engineering-campaign.js';

const now = new Date('2026-07-17T20:00:00.000Z');
function evidence() { return { recordId: 'e', tenantId: 'tenant-1', kind: 'd', subject: 'repo:alpha', payload: {}, evidenceClass: 'COMPUTED' as const, method: 'test', environment: {}, createdAt: now.toISOString(), limitations: [] }; }
function packet(tenantId = 'tenant-1', subjectId = 'repo:alpha'): GovernedDeliberationPacket {
  const material = { packetId: 'packet', deliberationId: 'request-1', tenantId, subjectId, requesterId: 'operator', perspectiveCount: 2, roleCoverage: ['ARCHITECTURE','TEST'] as const, missingRoles: [] as const, receiptDigests: [], supportedClaims: [], unsupportedClaims: [], hypotheses: [], conflicts: [], workNodes: [], workKindCoverage: [], toolCoverage: [], aggregateUsage: { inputChars: 1, outputChars: 1, latencyMs: 1 }, synthesisState: 'READY_FOR_CAMPAIGN' as const, executionState: 'REVIEW_REQUIRED' as const, promotionCeiling: 'research' as const, externalInteractionsExecuted: 0, externalMutationsExecuted: 0 as const, externalEffectsExecuted: 0 as const, generatedAt: now.toISOString(), limitations: [], evidence: evidence() };
  return { ...material, packetDigest: sha256({ ...material, evidence: material.evidence }) };
}
function item(id: string, kind: CampaignWorkItem['kind'], total: number, dependencies: string[] = []): CampaignWorkItem {
  return { itemId: id, sourceNodeId: `source-${id}`, role: 'ARCHITECTURE', kind, summary: id, dependencies, scores: { userValue: 1, riskReduction: 1, reuse: 1, evidenceUrgency: 1, effort: 1, complexity: 1, total }, proofObligations: ['TEST','REVIEW'], stopConditions: ['stop'], reviewRequired: true, state: 'PROPOSAL_ONLY' } as CampaignWorkItem;
}
function campaign(items: CampaignWorkItem[], tenantId = 'tenant-1', subjectId = 'repo:alpha'): GovernedEngineeringCampaign {
  const material = { campaignId: 'campaign-1', tenantId, subjectId, requesterId: 'operator', deliberationPacketDigest: 'd', planningInputDigest: 'i', deliberationState: 'READY_FOR_CAMPAIGN' as const, items, stages: [], excluded: [], totalEffort: items.length, aggregateScore: items.reduce((sum, row) => sum + row.scores.total, 0), proofCoverage: ['TEST','REVIEW'] as const, missingProofKinds: [], nextPermittedItemIds: items.map((row) => row.itemId), executionState: 'REVIEW_REQUIRED' as const, promotionCeiling: 'research' as const, externalInteractionsExecuted: 0, externalMutationsExecuted: 0 as const, externalEffectsExecuted: 0 as const, generatedAt: now.toISOString(), limitations: [] };
  return { ...material, campaignDigest: sha256(material) };
}
function request(): GovernedProductCompletionRequest { return { requestId: 'request-1', campaignId: 'campaign-1', deliberation: { deliberationId: 'request-1' } as never, campaignPolicy: {} as never }; }
function coordinator(input: { packetSignerRegistered?: boolean; campaignSignerRegistered?: boolean; tenantMismatch?: boolean; items?: CampaignWorkItem[] } = {}) {
  const councilSigner = generateSigningIdentity('council-product-branch'); const campaignSigner = generateSigningIdentity('campaign-product-branch'); const bundleSigner = generateSigningIdentity('bundle-product-branch'); const registry = new KeyRegistry();
  if (input.packetSignerRegistered !== false) registry.register(councilSigner.keyId, councilSigner.publicKey); if (input.campaignSignerRegistered !== false) registry.register(campaignSigner.keyId, campaignSigner.publicKey);
  const signedPacket = signEnvelope(packet(), councilSigner); const signedCampaign = signEnvelope(campaign(input.items ?? [], input.tenantMismatch ? 'other' : 'tenant-1'), campaignSigner);
  const runner = { council: { keyRegistry: registry }, run: async () => signedPacket } as never;
  const planner = { keyRegistry: registry, plan: () => signedCampaign } as never;
  return new GovernedProductCompletionCoordinator(runner, planner, bundleSigner);
}

test('product completion maps all priority and action category branches with dependency traceability', async () => {
  const items = [item('p1','TEST_PROPOSAL',60), item('p2','CHANGE_PROPOSAL',45), item('p3','OPERATIONAL_RECOMMENDATION',30,['source-p1']), item('p4','ANALYSIS',10)];
  const result = await coordinator({ items }).prepare(request(), now);
  const actions = result.payload.actionLedger.states.map((row) => row.action).sort((a,b) => a.id.localeCompare(b.id));
  assert.deepEqual(actions.map((row) => row.priority), [1,2,3,4]); assert.deepEqual(actions.map((row) => row.category), ['verify','repair','monitor','verify']);
  assert.ok(result.payload.traceability.some((link) => link.relation === 'DEPENDS_ON')); assert.equal(result.payload.metrics.campaignItemsSelected, 4);
});

test('product completion rejects empty identifiers and invalid clock', async () => {
  const c = coordinator(); await assert.rejects(c.prepare({ ...request(), requestId: '' }, now), /request_required/); await assert.rejects(c.prepare({ ...request(), campaignId: '' }, now), /request_required/); await assert.rejects(c.prepare(request(), new Date(Number.NaN)), /time_invalid/);
});

test('product completion rejects invalid deliberation signature and identity mismatch', async () => {
  await assert.rejects(coordinator({ packetSignerRegistered: false }).prepare(request(), now), /deliberation_signature_invalid/);
  await assert.rejects(coordinator({ tenantMismatch: true }).prepare(request(), now), /identity_mismatch/);
});
