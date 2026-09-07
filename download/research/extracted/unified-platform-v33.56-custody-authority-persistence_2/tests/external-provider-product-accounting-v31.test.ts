import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AuthorityGrant } from '../src/contracts/canonical.js';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { FileModelRunStore, GovernedModelOrchestrator, type ModelAdapterInput, type ModelAdapterOutput } from '../src/ai/governed-model-orchestrator.js';
import { GovernedDeliberationCouncil, GovernedDeliberationRunner, InMemoryDeliberationStore } from '../src/ai/governed-deliberation.js';
import { SovereignAttestedProviderBoundary, providerDisclosureDigest, type AttestedProviderAdapter, type ProviderEgressPolicy } from '../src/ai/provider-sovereignty.js';
import { ProviderTrustRegistry, type ProviderCredential } from '../src/security/provider-trust.js';
import { InMemoryReplayLedger } from '../src/platform/replay-ledger.js';
import { GovernedEngineeringCampaignPlanner, InMemoryCampaignStore } from '../src/product/engineering-campaign.js';
import { GovernedProductCompletionCoordinator } from '../src/app/governed-product-completion.js';
import { registerCredentialIssuerFixture } from './credential-issuer-fixtures.js';

const now = new Date('2026-07-17T23:30:00.000Z');
const egressPolicy: ProviderEgressPolicy = { allowedContextSources: ['canonical-deliberation-role','program-state'], allowUntrustedContext: false, maxDisclosedChars: 20_000, secretHandling: 'REJECT_DETECTED_SECRETS' };

test('external provider interactions are counted through deliberation, campaign and product while mutations remain zero', async () => {
  const authority = generateSigningIdentity('accounting-authority'); const receiptSigner = generateSigningIdentity('accounting-receipt'); const councilSigner = generateSigningIdentity('accounting-council'); const campaignSigner = generateSigningIdentity('accounting-campaign'); const bundleSigner = generateSigningIdentity('accounting-bundle'); const providerIssuer = generateSigningIdentity('accounting-provider-issuer'); const providerRoot = generateSigningIdentity('accounting-provider-root'); const providerSigner = generateSigningIdentity('accounting-provider');
  const registry = new KeyRegistry(); for (const signer of [authority, receiptSigner, councilSigner, campaignSigner, bundleSigner, providerIssuer, providerRoot, providerSigner]) registry.register(signer.keyId, signer.publicKey);
  const issuerFixture = registerCredentialIssuerFixture({ registry, root: providerRoot, issuer: providerIssuer, kinds: ['PROVIDER'], tenantIds: ['tenant-1'], scopes: ['model.invoke'], now }); const providerTrust = new ProviderTrustRegistry(registry, issuerFixture.trust, () => now); const credential: ProviderCredential = { credentialId: 'accounting-provider-credential', providerId: 'qualified-provider', providerKeyId: providerSigner.keyId, allowedModels: ['sol-5.6-qualified'], tenantIds: ['tenant-1'], scopes: ['model.invoke'], issuedAt: new Date(now.getTime()-60_000).toISOString(), expiresAt: new Date(now.getTime()+60_000).toISOString(), issuerId: providerIssuer.keyId, issuerGrantDigest: issuerFixture.grantDigest }; providerTrust.register(signEnvelope(credential, providerIssuer));
  let providerCalls = 0;
  const provider: AttestedProviderAdapter = { invokeAttested: async (input: ModelAdapterInput) => {
    providerCalls += 1; const role = /^\[([A-Z]+)\]/.exec(input.objective)?.[1] ?? 'UNKNOWN'; const text = `${role} attested proposal`; const kind = role === 'TEST' ? 'TEST_PROPOSAL' as const : 'CHANGE_PROPOSAL' as const; const output: ModelAdapterOutput = { provider: 'qualified-provider', model: 'sol-5.6-qualified', output: text, claims: [{ claimId: `claim:${role}`, statement: `${role} proposal is evidence-bound.`, classification: 'SUPPORTED', evidenceRefs: [`evidence:${role.toLowerCase()}`] }], workGraph: [{ nodeId: `work:${role}`, kind, summary: `${role} work`, dependsOn: [], ...(kind === 'TEST_PROPOSAL' ? { requestedTool: 'tests.propose' as const } : { requestedTool: 'change.propose' as const }), payload: { proofObligations: kind === 'TEST_PROPOSAL' ? ['TEST','MUTATION'] : ['CODE','REVIEW'], stopConditions: ['evidence-substitution'] } }], usage: { inputChars: input.context.reduce((sum, item) => sum + item.content.length, 0), outputChars: text.length, latencyMs: 5 }, startedAt: now.toISOString(), finishedAt: new Date(now.getTime()+5).toISOString(), limitations: ['attestation-proves-binding-not-correctness'] };
    const attestation = signEnvelope({ attestationId: `attestation:${input.requestDigest}`, nonce: `nonce:${input.requestDigest}`, providerId: output.provider, providerKeyId: providerSigner.keyId, model: output.model, tenantId: input.tenantId, subjectId: input.subjectId, requestDigest: input.requestDigest, inputDigest: sha256(input), policyDigest: sha256({ purpose: input.purpose, allowedTools: [...input.allowedTools].sort(), budget: input.budget }), outputDigest: sha256(output), semanticOutputDigest: sha256({ output: output.output, claims: output.claims, workGraph: output.workGraph }), disclosureDigest: providerDisclosureDigest(input, egressPolicy), startedAt: output.startedAt, finishedAt: output.finishedAt, issuedAt: new Date(now.getTime()+5).toISOString() }, providerSigner);
    return { output, attestation };
  } };
  const boundary = new SovereignAttestedProviderBoundary(registry, providerTrust, new InMemoryReplayLedger(), provider, egressPolicy, () => now);
  const root = mkdtempSync(join(tmpdir(), 'external-accounting-v31-')); const model = new GovernedModelOrchestrator(registry, receiptSigner, boundary, new FileModelRunStore(join(root, 'models'))); const council = new GovernedDeliberationCouncil(registry, councilSigner, new InMemoryDeliberationStore()); const runner = new GovernedDeliberationRunner(model, council); const planner = new GovernedEngineeringCampaignPlanner(registry, campaignSigner, new InMemoryCampaignStore()); const coordinator = new GovernedProductCompletionCoordinator(runner, planner, bundleSigner);
  const grant: AuthorityGrant = { grantId: 'accounting-grant', tenantId: 'tenant-1', subjectId: 'repo:alpha', scopes: ['model.design','model.analyze'], issuedAt: new Date(now.getTime()-1_000).toISOString(), expiresAt: new Date(now.getTime()+60_000).toISOString(), issuer: 'kernel' };
  const signed = await coordinator.prepare({ requestId: 'accounting-deliberation', campaignId: 'accounting-campaign', deliberation: { deliberationId: 'accounting-deliberation', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', authority: signEnvelope(grant, authority), context: [{ contextId: 'program', source: 'program-state', trust: 'TRUSTED', priority: 10, content: 'Attested external model context.', evidenceRefs: ['evidence:architecture','evidence:test'] }], perRoleBudget: { maxContextChars: 5_000, maxOutputChars: 1_000, maxClaims: 5, maxGraphNodes: 5, maxToolProposals: 3, maxLatencyMs: 1_000 }, aggregateBudget: { maxRoles: 2, maxTotalInputChars: 10_000, maxTotalOutputChars: 2_000, maxTotalLatencyMs: 2_000 }, roles: [{ role: 'ARCHITECTURE', perspectiveId: 'architecture', purpose: 'DESIGN', objective: 'design', allowedTools: ['repository.read','change.propose'] }, { role: 'TEST', perspectiveId: 'test', purpose: 'ANALYZE', objective: 'test', allowedTools: ['repository.read','tests.propose'] }], createdAt: now.toISOString() }, campaignPolicy: { maxItems: 5, maxTotalEffort: 20, maxParallelism: 2, minimumScore: 0, requiredProofKinds: ['TEST','REVIEW'], forbiddenTools: [] } }, now);
  assert.equal(providerCalls, 2); assert.equal(signed.payload.deliberation.payload.externalInteractionsExecuted, 2); assert.equal(signed.payload.campaign.payload.externalInteractionsExecuted, 2); assert.equal(signed.payload.metrics.externalInteractionsExecuted, 2);
  assert.equal(signed.payload.deliberation.payload.externalMutationsExecuted, 0); assert.equal(signed.payload.campaign.payload.externalMutationsExecuted, 0); assert.equal(signed.payload.metrics.externalMutationsExecuted, 0); assert.equal(signed.payload.metrics.externalEffectsExecuted, 0);
  assert.ok(signed.payload.limitations.includes('external-model-interactions-are-counted-not-hidden'));
});

test('deliberation rejects any model receipt that reports an external mutation', async () => {
  const authority = generateSigningIdentity('mutation-authority');
  const receiptSigner = generateSigningIdentity('mutation-receipt');
  const councilSigner = generateSigningIdentity('mutation-council');
  const registry = new KeyRegistry();
  for (const signer of [authority, receiptSigner, councilSigner]) registry.register(signer.keyId, signer.publicKey);
  const adapter = {
    invoke: async (input: ModelAdapterInput): Promise<ModelAdapterOutput> => ({
      provider: 'local-fixture', model: 'deterministic', output: 'proposal', claims: [],
      workGraph: [{ nodeId: 'analysis', kind: 'ANALYSIS', summary: 'Analyze safely', dependsOn: [], requestedTool: 'repository.read', payload: {} }],
      usage: { inputChars: input.context.reduce((sum, item) => sum + item.content.length, 0), outputChars: 'proposal'.length, latencyMs: 0 },
      startedAt: now.toISOString(), finishedAt: now.toISOString(), limitations: ['local-fixture'],
    }),
  };
  const model = new GovernedModelOrchestrator(registry, receiptSigner, adapter);
  const grant: AuthorityGrant = { grantId: 'mutation-grant', tenantId: 'tenant-1', subjectId: 'repo:alpha', scopes: ['model.analyze'], issuedAt: new Date(now.getTime()-1_000).toISOString(), expiresAt: new Date(now.getTime()+60_000).toISOString(), issuer: 'kernel' };
  const receipt = await model.execute({ requestId: 'mutation-request', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', purpose: 'ANALYZE', objective: 'analyze', authority: signEnvelope(grant, authority), allowedTools: ['repository.read'], context: [{ contextId: 'c', source: 'registry', trust: 'TRUSTED', priority: 1, content: 'safe' }], budget: { maxContextChars: 100, maxOutputChars: 100, maxClaims: 1, maxGraphNodes: 2, maxToolProposals: 1, maxLatencyMs: 100 }, createdAt: now.toISOString() }, now);
  const second = await model.execute({ requestId: 'mutation-request-2', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', purpose: 'ANALYZE', objective: 'analyze again', authority: signEnvelope(grant, authority), allowedTools: ['repository.read'], context: [{ contextId: 'c2', source: 'registry', trust: 'TRUSTED', priority: 1, content: 'safe' }], budget: { maxContextChars: 100, maxOutputChars: 100, maxClaims: 1, maxGraphNodes: 2, maxToolProposals: 1, maxLatencyMs: 100 }, createdAt: now.toISOString() }, now);
  const mutated = signEnvelope({ ...receipt.payload, externalMutationsExecuted: 1 } as never, receiptSigner);
  const council = new GovernedDeliberationCouncil(registry, councilSigner, new InMemoryDeliberationStore());
  assert.throws(() => council.synthesize({ deliberationId: 'mutation-deliberation', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', requiredRoles: ['TEST','SECURITY'], submissions: [{ role: 'TEST', perspectiveId: 'test', receipt: mutated }, { role: 'SECURITY', perspectiveId: 'security', receipt: second }], aggregateBudget: { maxRoles: 2, maxTotalInputChars: 200, maxTotalOutputChars: 200, maxTotalLatencyMs: 200 }, generatedAt: now.toISOString() }), /deliberation_authority_escalation/);
});
