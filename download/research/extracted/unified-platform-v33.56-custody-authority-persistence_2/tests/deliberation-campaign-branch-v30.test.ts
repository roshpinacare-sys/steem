import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope, type SignedEnvelope } from '../src/contracts/crypto.js';
import type { AuthorityGrant } from '../src/contracts/canonical.js';
import {
  FileDeliberationStore, GovernedDeliberationCouncil, GovernedDeliberationRunner, InMemoryDeliberationStore,
  type DeliberationRole, type DeliberationSubmission, type GovernedDeliberationPacket, type GovernedDeliberationRequest,
} from '../src/ai/governed-deliberation.js';
import {
  GovernedModelOrchestrator, InMemoryModelRunStore, type GovernedModelAdapter, type GovernedModelReceipt,
  type ModelAdapterInput, type ModelAdapterOutput,
} from '../src/ai/governed-model-orchestrator.js';
import {
  FileCampaignStore, GovernedCampaignTracker, GovernedEngineeringCampaignPlanner, InMemoryCampaignStore,
  type CampaignItemResult, type CampaignPolicy, type CampaignStore,
} from '../src/product/engineering-campaign.js';
import { ReviewerTrustRegistry } from '../src/security/reviewer-trust.js';
import { registerReviewerFixture, reviewerAttestation } from './reviewer-fixtures.js';
import { registerCredentialIssuerFixture } from './credential-issuer-fixtures.js';

const now = new Date('2026-07-17T19:00:00.000Z');
class FixtureAdapter implements GovernedModelAdapter {
  async invoke(input: ModelAdapterInput): Promise<ModelAdapterOutput> {
    return { provider: 'fixture', model: 'sol-5.6-fixture', output: 'bounded', claims: [], workGraph: [], usage: { inputChars: 1, outputChars: 1, latencyMs: 1 }, startedAt: now.toISOString(), finishedAt: new Date(now.getTime() + 1).toISOString(), limitations: [] };
  }
}
function evidence(tenantId = 'tenant-1') { return { recordId: 'e', tenantId, kind: 'model', subject: 'repo:alpha', payload: {}, evidenceClass: 'COMPUTED' as const, method: 'fixture', environment: {}, createdAt: now.toISOString(), limitations: [] }; }
function receipt(role: DeliberationRole, signer = generateSigningIdentity(`model-${role}`), patch: Partial<GovernedModelReceipt> = {}): { signer: ReturnType<typeof generateSigningIdentity>; signed: SignedEnvelope<GovernedModelReceipt> } {
  const requestId = `delib:${role.toLowerCase()}`;
  const material: GovernedModelReceipt = {
    receiptId: `receipt:${role}`, requestId, requestDigest: sha256({ requestId }), tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', purpose: 'ANALYZE', provider: 'fixture', model: 'sol-5.6-fixture', selectedContextIds: [], trustedEvidenceRefs: [], untrustedContextIds: [], droppedContext: [], contextDigest: sha256([]), output: role, outputDigest: sha256(role), claims: [], workGraph: [], workGraphDigest: sha256([]), usage: { inputChars: 1, outputChars: 1, latencyMs: 1 }, externalInteractionsExecuted: 0, externalMutationsExecuted: 0, providerReport: { usage: { inputChars: 1, outputChars: 1, latencyMs: 1 }, startedAt: now.toISOString(), finishedAt: new Date(now.getTime() + 1).toISOString() }, startedAt: now.toISOString(), finishedAt: new Date(now.getTime() + 1).toISOString(), status: 'PROPOSAL_ONLY', promotionCeiling: 'research', limitations: [], evidence: evidence(), ...patch,
  };
  return { signer, signed: signEnvelope(material, signer) };
}
function councilSetup(store = new InMemoryDeliberationStore()) {
  const councilSigner = generateSigningIdentity('council-branch'); const registry = new KeyRegistry(); registry.register(councilSigner.keyId, councilSigner.publicKey);
  const rows = [receipt('ARCHITECTURE'), receipt('SECURITY')]; for (const row of rows) registry.register(row.signer.keyId, row.signer.publicKey);
  return { registry, councilSigner, council: new GovernedDeliberationCouncil(registry, councilSigner, store), rows };
}
function councilInput(rows: ReturnType<typeof receipt>[], patch: Record<string, unknown> = {}) {
  return { deliberationId: 'delib', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', requiredRoles: ['ARCHITECTURE', 'SECURITY'] as DeliberationRole[], submissions: rows.map((row, index) => ({ role: index === 0 ? 'ARCHITECTURE' as const : 'SECURITY' as const, perspectiveId: `p-${index}`, receipt: row.signed })), aggregateBudget: { maxRoles: 5, maxTotalInputChars: 100, maxTotalOutputChars: 100, maxTotalLatencyMs: 100 }, generatedAt: now.toISOString(), ...patch };
}
function packet(nodes: GovernedDeliberationPacket['workNodes'] = [], patch: Partial<GovernedDeliberationPacket> = {}): GovernedDeliberationPacket {
  const material = { packetId: 'p', deliberationId: 'd', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', perspectiveCount: 2, roleCoverage: ['ARCHITECTURE','SECURITY'] as DeliberationRole[], missingRoles: [] as DeliberationRole[], receiptDigests: ['r'], supportedClaims: [], unsupportedClaims: [], hypotheses: [], conflicts: [], workNodes: nodes, workKindCoverage: [...new Set(nodes.map((n) => n.kind))], toolCoverage: [...new Set(nodes.flatMap((n) => n.requestedTool ? [n.requestedTool] : []))], aggregateUsage: { inputChars: 1, outputChars: 1, latencyMs: 1 }, synthesisState: 'READY_FOR_CAMPAIGN' as const, executionState: 'REVIEW_REQUIRED' as const, promotionCeiling: 'research' as const, externalInteractionsExecuted: 0, externalMutationsExecuted: 0 as const, externalEffectsExecuted: 0 as const, generatedAt: now.toISOString(), limitations: [], evidence: evidence(), ...patch };
  return { ...material, packetDigest: sha256({ ...material, evidence: material.evidence }) };
}
function work(id: string, patch: Record<string, unknown> = {}): GovernedDeliberationPacket['workNodes'][number] { return { nodeId: id, role: 'ARCHITECTURE', perspectiveId: 'p', sourceRequestId: 'r', kind: 'ANALYSIS', summary: id, dependsOn: [], payload: {}, ...patch } as GovernedDeliberationPacket['workNodes'][number]; }
const campaignPolicy: CampaignPolicy = { maxItems: 5, maxTotalEffort: 30, maxParallelism: 2, minimumScore: -100, requiredProofKinds: ['CODE','TEST','REVIEW'], forbiddenTools: [] };
function campaignSetup(store: CampaignStore = new InMemoryCampaignStore()) {
  const deliberationSigner = generateSigningIdentity('delib-campaign-branch'); const campaignSigner = generateSigningIdentity('campaign-branch'); const reviewerA = generateSigningIdentity('review-a-branch'); const reviewerB = generateSigningIdentity('review-b-branch'); const credentialIssuer = generateSigningIdentity('review-credential-issuer-branch'); const credentialRoot = generateSigningIdentity('review-credential-root-branch'); const registry = new KeyRegistry();
  for (const signer of [deliberationSigner, campaignSigner, reviewerA, reviewerB, credentialIssuer, credentialRoot]) registry.register(signer.keyId, signer.publicKey);
  const issuerFixture = registerCredentialIssuerFixture({ registry, root: credentialRoot, issuer: credentialIssuer, kinds: ['REVIEWER'], tenantIds: ['tenant-1'], scopes: ['campaign.review'], now });
  const reviewerTrust = new ReviewerTrustRegistry(registry, issuerFixture.trust, () => now);
  const reviewerAProfile = registerReviewerFixture({ registry, trust: reviewerTrust, issuer: credentialIssuer, signer: reviewerA, organizationId: 'branch-org-a', now });
  const reviewerBProfile = registerReviewerFixture({ registry, trust: reviewerTrust, issuer: credentialIssuer, signer: reviewerB, organizationId: 'branch-org-b', now });
  return { registry, reviewerTrust, credentialIssuer, deliberationSigner, campaignSigner, reviewerA, reviewerB, reviewerAProfile, reviewerBProfile, store, planner: new GovernedEngineeringCampaignPlanner(registry, campaignSigner, store), tracker: new GovernedCampaignTracker(registry, reviewerTrust, store) };
}
function itemResult(campaignId: string, itemId: string, h: ReturnType<typeof campaignSetup>, patch: Partial<CampaignItemResult> = {}): CampaignItemResult {
  const evidenceRefs = ['evidence:1']; const digest = sha256(evidenceRefs); const status = patch.status ?? 'SUCCEEDED';
  return { resultId: 'result', campaignId, itemId, status, evidenceRefs, reviewerAttestations: [reviewerAttestation({ fixture: h.reviewerAProfile, campaignId, itemId, status, evidenceDigest: digest, reviewedAt: now.toISOString() }), reviewerAttestation({ fixture: h.reviewerBProfile, campaignId, itemId, status, evidenceDigest: digest, reviewedAt: now.toISOString() })], actualEffort: 1, completedAt: now.toISOString(), limitations: [], ...patch };
}

test('deliberation stores cover missing, idempotent, conflict, key mismatch and empty identifiers', () => {
  const memory = new InMemoryDeliberationStore(); assert.equal(memory.get('missing'), undefined);
  const h = councilSetup(memory); const signed = h.council.synthesize(councilInput(h.rows));
  const row = memory.get('delib')!; assert.equal(memory.put({ deliberationId: 'delib', requestDigest: row.requestDigest, signedPacket: signed }).digest, row.digest);
  assert.throws(() => memory.put({ deliberationId: 'delib', requestDigest: 'changed', signedPacket: signed }), /store_conflict/);
  assert.throws(() => new FileDeliberationStore(''), /root_required/);
  const root = mkdtempSync(join(tmpdir(), 'delib-branch-')); const file = new FileDeliberationStore(root); assert.equal(file.get('missing'), undefined); assert.throws(() => file.get(''), /id_required/);
  file.put({ deliberationId: 'x', requestDigest: 'd', signedPacket: signed }); const name = readdirSync(root)[0]!; const data = JSON.parse(readFileSync(join(root, name), 'utf8')); data.deliberationId = 'y'; const { digest: _old, ...material } = data; data.digest = sha256(material); writeFileSync(join(root, name), JSON.stringify(data));
  assert.throws(() => file.get('x'), /key_mismatch/);
});

test('council covers role gaps, claim classes, tools and all aggregate budget dimensions', () => {
  const h = councilSetup(); const base = h.rows;
  const rich = [
    receipt('ARCHITECTURE', base[0]!.signer, { claims: [{ claimId: 's', statement: 'supported', classification: 'SUPPORTED', evidenceRefs: ['e1'] }, { claimId: 'u', statement: 'unsupported', classification: 'UNSUPPORTED', evidenceRefs: [] }], workGraph: [{ nodeId: 'n', kind: 'CHANGE_PROPOSAL', summary: 'change', dependsOn: [], requestedTool: 'change.propose', payload: {} }], workGraphDigest: sha256('custom') }),
    receipt('SECURITY', base[1]!.signer, { claims: [{ claimId: 'h', statement: 'hypothesis', classification: 'HYPOTHESIS', evidenceRefs: [] }] }),
  ];
  const ready = h.council.synthesize(councilInput(rich)); assert.deepEqual(ready.payload.supportedClaims, ['s']); assert.deepEqual(ready.payload.unsupportedClaims, ['u']); assert.deepEqual(ready.payload.hypotheses, ['h']); assert.deepEqual(ready.payload.toolCoverage, ['change.propose']);
  const h2 = councilSetup(); const incomplete = h2.council.synthesize(councilInput(h2.rows, { requiredRoles: ['ARCHITECTURE','SECURITY','TEST'] })); assert.equal(incomplete.payload.synthesisState, 'ROLE_COVERAGE_INCOMPLETE');
  for (const key of ['maxTotalInputChars','maxTotalOutputChars','maxTotalLatencyMs'] as const) { const hx = councilSetup(); assert.throws(() => hx.council.synthesize(councilInput(hx.rows, { deliberationId: `budget-${key}`, aggregateBudget: { ...councilInput(hx.rows).aggregateBudget, [key]: 1 } })), /aggregate_budget_exceeded/); }
});

test('council validates identity, authority, duplicate and malformed submission branches', () => {
  const h = councilSetup(); const input = councilInput(h.rows);
  for (const key of ['tenantId','subjectId','requesterId'] as const) { const rows = h.rows.map((r, i) => i === 0 ? receipt('ARCHITECTURE', r.signer, { [key]: 'other' }) : r); assert.throws(() => h.council.synthesize(councilInput(rows, { deliberationId: `identity-${key}` })), /identity_mismatch/); }
  const elevated = receipt('ARCHITECTURE', h.rows[0]!.signer, { status: 'PROPOSAL_ONLY', promotionCeiling: 'production' as never }); assert.throws(() => h.council.synthesize(councilInput([elevated, h.rows[1]!], { deliberationId: 'elevated' })), /authority_escalation/);
  assert.throws(() => h.council.synthesize({ ...input, deliberationId: '' }), /input_required/); assert.throws(() => h.council.synthesize({ ...input, generatedAt: 'bad' }), /generated_time_invalid/);
  assert.throws(() => h.council.synthesize({ ...input, requiredRoles: ['ARCHITECTURE'] }), /required_roles_invalid/); assert.throws(() => h.council.synthesize({ ...input, submissions: [] }), /submissions_invalid/);
  assert.throws(() => h.council.synthesize({ ...input, submissions: [input.submissions[0]!, { ...input.submissions[1]!, perspectiveId: input.submissions[0]!.perspectiveId }] }), /submission_duplicate/);
  assert.throws(() => h.council.synthesize({ ...input, submissions: [{ ...input.submissions[0]!, perspectiveId: '' }, input.submissions[1]!] }), /submission_invalid/);
});

test('runner validates each request field, role configuration, time and budgets', async () => {
  const authoritySigner = generateSigningIdentity('authority-run-branch'); const modelSigner = generateSigningIdentity('model-run-branch'); const councilSigner = generateSigningIdentity('council-run-branch'); const registry = new KeyRegistry(); for (const s of [authoritySigner, modelSigner, councilSigner]) registry.register(s.keyId, s.publicKey);
  const grant: AuthorityGrant = { grantId: 'g', tenantId: 'tenant-1', subjectId: 'repo:alpha', scopes: ['model.analyze'], issuedAt: new Date(now.getTime()-1000).toISOString(), expiresAt: new Date(now.getTime()+1000).toISOString(), issuer: 'kernel' };
  const runner = new GovernedDeliberationRunner(new GovernedModelOrchestrator(registry, modelSigner, new FixtureAdapter(), new InMemoryModelRunStore()), new GovernedDeliberationCouncil(registry, councilSigner));
  const base: GovernedDeliberationRequest = { deliberationId: 'd', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', authority: signEnvelope(grant, authoritySigner), context: [], perRoleBudget: { maxContextChars: 100, maxOutputChars: 100, maxClaims: 2, maxGraphNodes: 2, maxToolProposals: 2, maxLatencyMs: 100 }, aggregateBudget: { maxRoles: 2, maxTotalInputChars: 1000, maxTotalOutputChars: 1000, maxTotalLatencyMs: 1000 }, roles: [{ role: 'ARCHITECTURE', perspectiveId: 'a', purpose: 'ANALYZE', objective: 'a', allowedTools: ['repository.read'] }, { role: 'SECURITY', perspectiveId: 's', purpose: 'ANALYZE', objective: 's', allowedTools: ['evidence.read'] }], createdAt: now.toISOString() };
  for (const key of ['deliberationId','tenantId','subjectId','requesterId'] as const) await assert.rejects(runner.run({ ...base, [key]: '' }, now), /required/);
  await assert.rejects(runner.run({ ...base, createdAt: 'bad' }, now), /time_invalid/); await assert.rejects(runner.run(base, new Date(Number.NaN)), /time_invalid/);
  await assert.rejects(runner.run({ ...base, roles: [base.roles[0]!] }, now), /role_count_invalid/);
  await assert.rejects(runner.run({ ...base, roles: [{ ...base.roles[0]!, objective: '' }, base.roles[1]!] }, now), /role_invalid/);
  await assert.rejects(runner.run({ ...base, aggregateBudget: { ...base.aggregateBudget, maxTotalLatencyMs: 0 } }, now), /budget_invalid/);
});

test('campaign in-memory store, file identifiers, conflict synthesis and empty campaign branches', () => {
  const memory = new InMemoryCampaignStore(); assert.equal(memory.getPlan('missing'), undefined); assert.equal(memory.getSnapshot('missing'), undefined);
  const h = campaignSetup(memory); const signed = h.planner.plan({ campaignId: 'empty', deliberation: signEnvelope(packet([]), h.deliberationSigner), policy: campaignPolicy, generatedAt: now.toISOString() }); assert.equal(signed.payload.items.length, 0); assert.equal(memory.getSnapshot('empty')!.campaignState, 'BLOCKED');
  memory.putPlan(signed); assert.throws(() => memory.putPlan(signEnvelope({ ...signed.payload, generatedAt: new Date(now.getTime()+1).toISOString() }, h.campaignSigner)), /plan_conflict/);
  const root = mkdtempSync(join(tmpdir(), 'campaign-file-branch-')); const file = new FileCampaignStore(root); assert.equal(file.getPlan('missing'), undefined); assert.equal(file.getSnapshot('missing'), undefined); assert.throws(() => file.getPlan(''), /id_required/); assert.throws(() => new FileCampaignStore(''), /root_required/);
  const h2 = campaignSetup(file); assert.throws(() => h2.planner.plan({ campaignId: 'conflict', deliberation: signEnvelope(packet([], { synthesisState: 'CONFLICT_REVIEW_REQUIRED' }), h2.deliberationSigner), policy: campaignPolicy, generatedAt: now.toISOString() }), /conflict_review_required/);
});

test('campaign planner covers item limits, dependency rejection, missing proof and parallel waves', () => {
  const h = campaignSetup(); const nodes = [work('a'), work('b'), work('c', { dependsOn: ['missing'] }), work('d', { requestedTool: 'blocked' })];
  const plan = h.planner.plan({ campaignId: 'budget-branches', deliberation: signEnvelope(packet(nodes), h.deliberationSigner), policy: { ...campaignPolicy, maxItems: 1, maxParallelism: 1, forbiddenTools: ['blocked'], requiredProofKinds: ['CODE','TEST','MUTATION','VALUE'] }, generatedAt: now.toISOString() });
  assert.ok(plan.payload.excluded.some((row) => row.reason === 'ITEM_LIMIT')); assert.ok(plan.payload.excluded.some((row) => row.reason === 'FORBIDDEN_TOOL')); assert.ok(plan.payload.missingProofKinds.length > 0); assert.ok(plan.payload.limitations.includes('campaign-does-not-yet-cover-all-required-proof-kinds'));
  const dependencyHarness = campaignSetup(); const dependencyPlan = dependencyHarness.planner.plan({ campaignId: 'dependency-rejection', deliberation: signEnvelope(packet([work('c', { dependsOn: ['missing'] })]), dependencyHarness.deliberationSigner), policy: campaignPolicy, generatedAt: now.toISOString() }); assert.ok(dependencyPlan.payload.excluded.some((row) => row.reason === 'DEPENDENCY_NOT_SELECTED'));
  const h2 = campaignSetup(); const waves = h2.planner.plan({ campaignId: 'waves', deliberation: signEnvelope(packet([work('x'),work('y'),work('z')]), h2.deliberationSigner), policy: { ...campaignPolicy, maxParallelism: 1 }, generatedAt: now.toISOString() }); assert.equal(waves.payload.stages.length, 3);
});

test('campaign validates malformed inputs, policy proof and forbidden-tool branches', () => {
  const h = campaignSetup(); const deliberation = signEnvelope(packet([work('a')]), h.deliberationSigner);
  assert.throws(() => h.planner.plan({ campaignId: '', deliberation, policy: campaignPolicy, generatedAt: now.toISOString() }), /input_invalid/); assert.throws(() => h.planner.plan({ campaignId: 'x', deliberation, policy: campaignPolicy, generatedAt: 'bad' }), /input_invalid/);
  assert.throws(() => h.planner.plan({ campaignId: 'x', deliberation, policy: { ...campaignPolicy, maxItems: 501 }, generatedAt: now.toISOString() }), /policy_excessive/);
  assert.throws(() => h.planner.plan({ campaignId: 'x', deliberation, policy: { ...campaignPolicy, requiredProofKinds: [] }, generatedAt: now.toISOString() }), /proof_policy_invalid/);
  assert.throws(() => h.planner.plan({ campaignId: 'x', deliberation, policy: { ...campaignPolicy, requiredProofKinds: ['TEST','TEST'] }, generatedAt: now.toISOString() }), /proof_policy_invalid/);
  assert.throws(() => h.planner.plan({ campaignId: 'x', deliberation, policy: { ...campaignPolicy, forbiddenTools: [''] }, generatedAt: now.toISOString() }), /forbidden_tools_invalid/);
  assert.throws(() => h.planner.plan({ campaignId: 'x', deliberation: signEnvelope(packet([work('a')], { externalMutationsExecuted: 1 as never }), h.deliberationSigner), policy: campaignPolicy, generatedAt: now.toISOString() }), /authority_escalation/);
});

test('campaign tracker covers failure, blocked, idempotent, plan mismatch and attestation errors', () => {
  const h = campaignSetup(); const plan = h.planner.plan({ campaignId: 'states', deliberation: signEnvelope(packet([work('a'), work('b')]), h.deliberationSigner), policy: campaignPolicy, generatedAt: now.toISOString() }); const [a,b] = plan.payload.items;
  const failed = h.tracker.record('states', itemResult('states', a!.itemId, h, { status: 'FAILED' })); assert.equal(failed.campaignState, 'REVIEW_REQUIRED'); assert.equal(h.tracker.record('states', itemResult('states', a!.itemId, h, { status: 'FAILED' })).digest, failed.digest);
  const blocked = h.tracker.record('states', itemResult('states', b!.itemId, h, { status: 'BLOCKED', resultId: 'blocked' })); assert.equal(blocked.campaignState, 'REVIEW_REQUIRED');
  const bad = itemResult('states', b!.itemId, h, { resultId: 'bad', completedAt: 'bad' }); assert.throws(() => h.tracker.record('states', bad), /result_invalid/);
  const unknown = itemResult('states', 'unknown', h); assert.throws(() => h.tracker.record('states', unknown), /item_invalid/);
  const effort = itemResult('states', b!.itemId, h, { resultId: 'effort', actualEffort: -1 }); assert.throws(() => h.tracker.record('states', effort), /effort_invalid/);
  const content = itemResult('states', b!.itemId, h, { resultId: 'content', limitations: [''] }); assert.throws(() => h.tracker.record('states', content), /content_invalid/);
  const att = itemResult('states', b!.itemId, h, { resultId: 'att' }); const first = att.reviewerAttestations[0]!; const wrongBinding = signEnvelope({ ...first.payload, campaignId: 'other' }, h.reviewerA); assert.throws(() => h.tracker.record('states', { ...att, reviewerAttestations: [wrongBinding, att.reviewerAttestations[1]!] }), /binding_invalid/);
});

test('campaign tracker rejects forged, future and duplicate reviewer attestations', () => {
  const h = campaignSetup(); const plan = h.planner.plan({ campaignId: 'attestation-security', deliberation: signEnvelope(packet([work('a')]), h.deliberationSigner), policy: campaignPolicy, generatedAt: now.toISOString() }); const item = plan.payload.items[0]!;
  const valid = itemResult('attestation-security', item.itemId, h); const rogue = generateSigningIdentity('rogue-reviewer');
  const forged = signEnvelope({ ...valid.reviewerAttestations[0]!.payload, reviewerId: rogue.keyId }, rogue);
  assert.throws(() => h.tracker.record('attestation-security', { ...valid, reviewerAttestations: [forged, valid.reviewerAttestations[1]!] }), /signature_invalid/);
  const future = signEnvelope({ ...valid.reviewerAttestations[0]!.payload, reviewedAt: new Date(now.getTime() + 1000).toISOString() }, h.reviewerA);
  assert.throws(() => h.tracker.record('attestation-security', { ...valid, reviewerAttestations: [future, valid.reviewerAttestations[1]!] }), /time_invalid/);
  const duplicate = signEnvelope({ ...valid.reviewerAttestations[0]!.payload }, h.reviewerA);
  assert.throws(() => h.tracker.record('attestation-security', { ...valid, reviewerAttestations: [valid.reviewerAttestations[0]!, duplicate] }), /dual_review_required/);
});

test('campaign tracker rejects snapshot bound to another plan', () => {
  const store = new InMemoryCampaignStore(); const h = campaignSetup(store); const plan = h.planner.plan({ campaignId: 'snapshot-binding', deliberation: signEnvelope(packet([work('a')]), h.deliberationSigner), policy: campaignPolicy, generatedAt: now.toISOString() });
  const snapshot = store.getSnapshot('snapshot-binding')!; store.putSnapshot('snapshot-binding', { campaignDigest: 'wrong', results: snapshot.results, itemStates: snapshot.itemStates, nextPermittedItemIds: snapshot.nextPermittedItemIds, progressPercent: snapshot.progressPercent, campaignState: snapshot.campaignState, lastUpdatedAt: snapshot.lastUpdatedAt });
  assert.throws(() => h.tracker.record('snapshot-binding', itemResult('snapshot-binding', plan.payload.items[0]!.itemId, h)), /snapshot_plan_mismatch/);
});

test('campaign planner rejects cyclic dependency graph', () => {
  const h = campaignSetup(); const nodes = [work('a', { dependsOn: ['b'] }), work('b', { dependsOn: ['a'] })];
  assert.throws(() => h.planner.plan({ campaignId: 'cycle', deliberation: signEnvelope(packet(nodes), h.deliberationSigner), policy: campaignPolicy, generatedAt: now.toISOString() }), /dependency_cycle/);
});
