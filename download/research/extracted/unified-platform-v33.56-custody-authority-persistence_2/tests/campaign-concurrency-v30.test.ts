import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope, type SigningIdentity } from '../src/contracts/crypto.js';
import { ReviewerTrustRegistry } from '../src/security/reviewer-trust.js';
import { registerReviewerFixture, reviewerAttestation, type ReviewerFixture } from './reviewer-fixtures.js';
import { registerCredentialIssuerFixture } from './credential-issuer-fixtures.js';
import type { GovernedDeliberationPacket, NamespacedWorkNode } from '../src/ai/governed-deliberation.js';
import { FileCampaignStore, GovernedEngineeringCampaignPlanner, GovernedCampaignTracker, type CampaignItemResult, type CampaignPolicy } from '../src/product/engineering-campaign.js';

const now = new Date('2026-07-17T18:00:00.000Z');
const policy: CampaignPolicy = { maxItems: 10, maxTotalEffort: 30, maxParallelism: 2, minimumScore: 0, requiredProofKinds: ['TEST', 'REVIEW'], forbiddenTools: [] };
function workNode(id: string): NamespacedWorkNode { return { nodeId: id, role: 'TEST', perspectiveId: 'p', sourceRequestId: 'r', kind: 'TEST_PROPOSAL', summary: id, dependsOn: [], payload: { userValue: 8, riskReduction: 8, effort: 2, complexity: 2 } }; }
function packet(nodes: readonly NamespacedWorkNode[]): GovernedDeliberationPacket {
  const material = {
    packetId: 'packet-concurrency', deliberationId: 'delib-concurrency', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', perspectiveCount: 3,
    roleCoverage: ['ARCHITECTURE', 'SECURITY', 'TEST'] as const, missingRoles: [] as const, receiptDigests: [sha256('r1')], supportedClaims: ['c'], unsupportedClaims: [], hypotheses: [], conflicts: [], workNodes: nodes,
    workKindCoverage: ['TEST_PROPOSAL'] as const, toolCoverage: [] as const, aggregateUsage: { inputChars: 10, outputChars: 10, latencyMs: 10 }, synthesisState: 'READY_FOR_CAMPAIGN' as const,
    executionState: 'REVIEW_REQUIRED' as const, promotionCeiling: 'research' as const, externalInteractionsExecuted: 0, externalMutationsExecuted: 0 as const, externalEffectsExecuted: 0 as const, generatedAt: now.toISOString(), limitations: ['review-required'],
    evidence: { recordId: 'e', tenantId: 'tenant-1', kind: 'd', subject: 'repo:alpha', payload: {}, evidenceClass: 'COMPUTED' as const, method: 'test', environment: {}, createdAt: now.toISOString(), limitations: [] },
  };
  return { ...material, packetDigest: sha256(material) };
}
function result(campaignId: string, itemId: string, reviewers: readonly ReviewerFixture[], suffix: string): CampaignItemResult {
  const evidenceRefs = [`evidence:${suffix}`]; const evidenceDigest = sha256(evidenceRefs);
  return {
    resultId: `result:${suffix}`, campaignId, itemId, status: 'SUCCEEDED', evidenceRefs,
    reviewerAttestations: reviewers.map((fixture) => reviewerAttestation({ fixture, campaignId, itemId, status: 'SUCCEEDED', evidenceDigest, reviewedAt: now.toISOString() })),
    actualEffort: 1, completedAt: now.toISOString(), limitations: [],
  };
}
function runWorker(inputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/src/cli/campaign-result-worker.js', inputPath], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('campaign_worker_timeout')); }, 10_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error(`campaign_worker_failed:${code}:${stderr}`)); else { assert.match(stdout, /"status":"passed"/); resolve(); } });
  });
}
function pem(identity: SigningIdentity): string { return identity.publicKey.export({ type: 'spki', format: 'pem' }).toString(); }

function setup() {
  const deliberation = generateSigningIdentity('deliberation-concurrency'); const campaign = generateSigningIdentity('campaign-concurrency'); const reviewerA = generateSigningIdentity('reviewer-a-concurrency'); const reviewerB = generateSigningIdentity('reviewer-b-concurrency'); const credentialIssuer = generateSigningIdentity('reviewer-issuer-concurrency'); const credentialRoot = generateSigningIdentity('reviewer-root-concurrency');
  const registry = new KeyRegistry(); for (const signer of [deliberation, campaign, reviewerA, reviewerB, credentialIssuer, credentialRoot]) registry.register(signer.keyId, signer.publicKey);
  const issuerFixture = registerCredentialIssuerFixture({ registry, root: credentialRoot, issuer: credentialIssuer, kinds: ['REVIEWER'], tenantIds: ['tenant-1'], scopes: ['campaign.review'], now });
  const reviewerTrust = new ReviewerTrustRegistry(registry, issuerFixture.trust, () => now);
  const reviewerAProfile = registerReviewerFixture({ registry, trust: reviewerTrust, issuer: credentialIssuer, signer: reviewerA, organizationId: 'concurrency-org-a', now });
  const reviewerBProfile = registerReviewerFixture({ registry, trust: reviewerTrust, issuer: credentialIssuer, signer: reviewerB, organizationId: 'concurrency-org-b', now });
  const root = mkdtempSync(join(tmpdir(), 'campaign-concurrency-')); const store = new FileCampaignStore(root); const planner = new GovernedEngineeringCampaignPlanner(registry, campaign, store);
  const plan = planner.plan({ campaignId: 'campaign-concurrent', deliberation: signEnvelope(packet([workNode('left'), workNode('right')]), deliberation), policy, generatedAt: now.toISOString() });
  return { root, store, registry, reviewerTrust, campaign, reviewerA, reviewerB, reviewerAProfile, reviewerBProfile, credentialIssuer, credentialRoot, issuerGrant: issuerFixture.grant, credentials: [reviewerAProfile.credential, reviewerBProfile.credential], plan };
}

test('concurrent workers preserve both independent campaign results', async () => {
  const h = setup(); const [left, right] = h.plan.payload.items;
  assert.ok(left); assert.ok(right);
  const publicKeys = [h.campaign, h.reviewerA, h.reviewerB, h.credentialIssuer, h.credentialRoot].map((identity) => ({ keyId: identity.keyId, pem: pem(identity) }));
  const inputA = join(h.root, 'worker-a.json'); const inputB = join(h.root, 'worker-b.json');
  writeFileSync(inputA, JSON.stringify({ root: h.root, campaignId: h.plan.payload.campaignId, result: result(h.plan.payload.campaignId, left.itemId, [h.reviewerAProfile, h.reviewerBProfile], 'left'), reviewerCredentials: h.credentials, credentialIssuerRootKeyIds: [h.credentialRoot.keyId], credentialIssuerGrants: [h.issuerGrant], acceptedAt: now.toISOString(), publicKeys }));
  writeFileSync(inputB, JSON.stringify({ root: h.root, campaignId: h.plan.payload.campaignId, result: result(h.plan.payload.campaignId, right.itemId, [h.reviewerAProfile, h.reviewerBProfile], 'right'), reviewerCredentials: h.credentials, credentialIssuerRootKeyIds: [h.credentialRoot.keyId], credentialIssuerGrants: [h.issuerGrant], acceptedAt: now.toISOString(), publicKeys }));
  await Promise.all([runWorker(inputA), runWorker(inputB)]);
  const snapshot = new FileCampaignStore(h.root).getSnapshot(h.plan.payload.campaignId)!;
  assert.equal(snapshot.results.length, 2); assert.equal(snapshot.progressPercent, 100); assert.equal(snapshot.campaignState, 'COMPLETED');
  assert.deepEqual(snapshot.results.map((row) => row.itemId).sort(), [left.itemId, right.itemId].sort());
});

test('file campaign store removes stale lock before recording result', () => {
  const h = setup(); const item = h.plan.payload.items[0]!;
  const lock = join(h.root, `lock-${sha256({ campaignId: h.plan.payload.campaignId })}.json`);
  writeFileSync(lock, JSON.stringify({ pid: 999999, acquiredAt: '2020-01-01T00:00:00.000Z' }));
  const old = new Date(Date.now() - 60_000); utimesSync(lock, old, old);
  const snapshot = new GovernedCampaignTracker(h.registry, h.reviewerTrust, new FileCampaignStore(h.root)).record(h.plan.payload.campaignId, result(h.plan.payload.campaignId, item.itemId, [h.reviewerAProfile, h.reviewerBProfile], 'stale-lock'));
  assert.equal(snapshot.results.length, 1); assert.equal(snapshot.progressPercent, 50);
});
