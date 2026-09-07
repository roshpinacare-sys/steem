import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { FileReplayLedger, InMemoryReplayLedger } from '../src/platform/replay-ledger.js';
import { SovereignAttestedProviderBoundary, providerDisclosureDigest, type AttestedProviderAdapter, type AttestedProviderResponse, type ProviderEgressPolicy } from '../src/ai/provider-sovereignty.js';
import { ProviderTrustRegistry, type ProviderCredential } from '../src/security/provider-trust.js';
import { FileModelRunStore, GovernedModelOrchestrator, type ModelAdapterInput, type ModelAdapterOutput } from '../src/ai/governed-model-orchestrator.js';
import { registerCredentialIssuerFixture } from './credential-issuer-fixtures.js';

const now = new Date('2026-07-17T22:00:00.000Z');
const egressPolicy: ProviderEgressPolicy = { allowedContextSources: ['registry'], allowUntrustedContext: false, maxDisclosedChars: 5_000, secretHandling: 'REJECT_DETECTED_SECRETS' };
function input(patch: Partial<ModelAdapterInput> = {}): ModelAdapterInput {
  return { requestDigest: sha256({ request: 1 }), tenantId: 'tenant-1', subjectId: 'repo:alpha', purpose: 'ANALYZE', objective: 'analyze safely', allowedTools: ['repository.read'], context: [], budget: { maxContextChars: 1000, maxOutputChars: 1000, maxClaims: 5, maxGraphNodes: 5, maxToolProposals: 2, maxLatencyMs: 1000 }, ...patch };
}
function output(patch: Partial<ModelAdapterOutput> = {}): ModelAdapterOutput {
  return { provider: 'provider-a', model: 'sol-5.6-qualified', output: 'bounded proposal', claims: [], workGraph: [], usage: { inputChars: 10, outputChars: 16, latencyMs: 5 }, startedAt: now.toISOString(), finishedAt: new Date(now.getTime() + 5).toISOString(), limitations: [], ...patch };
}
function setup(options: { tenantIds?: string[]; models?: string[]; revokedAt?: string; ledger?: InMemoryReplayLedger | FileReplayLedger } = {}) {
  const issuer = generateSigningIdentity('provider-credential-issuer'); const credentialRoot = generateSigningIdentity('provider-credential-root'); const provider = generateSigningIdentity('provider-signing-key'); const registry = new KeyRegistry();
  registry.register(provider.keyId, provider.publicKey);
  const issuerFixture = registerCredentialIssuerFixture({ registry, root: credentialRoot, issuer, kinds: ['PROVIDER'], tenantIds: options.tenantIds ?? ['tenant-1'], scopes: ['model.invoke'], now });
  const trust = new ProviderTrustRegistry(registry, issuerFixture.trust, () => now);
  const material: ProviderCredential = { credentialId: 'credential:provider-a', providerId: 'provider-a', providerKeyId: provider.keyId, allowedModels: options.models ?? ['sol-5.6-qualified'], tenantIds: options.tenantIds ?? ['tenant-1'], scopes: ['model.invoke'], issuedAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), issuerId: issuer.keyId, issuerGrantDigest: issuerFixture.grantDigest, ...(options.revokedAt === undefined ? {} : { revokedAt: options.revokedAt }) };
  const credential = signEnvelope(material, issuer); trust.register(credential);
  const makeResponse = (request: ModelAdapterInput, out = output(), patch: Record<string, unknown> = {}): AttestedProviderResponse => {
    const attestation = { attestationId: 'attestation-1', nonce: 'nonce-1', providerId: out.provider, providerKeyId: provider.keyId, model: out.model, tenantId: request.tenantId, subjectId: request.subjectId, requestDigest: request.requestDigest, inputDigest: sha256(request), policyDigest: sha256({ purpose: request.purpose, allowedTools: [...request.allowedTools].sort(), budget: request.budget }), outputDigest: sha256(out), semanticOutputDigest: sha256({ output: out.output, claims: out.claims, workGraph: out.workGraph }), disclosureDigest: providerDisclosureDigest(request, egressPolicy), startedAt: out.startedAt, finishedAt: out.finishedAt, issuedAt: new Date(now.getTime() + 5).toISOString(), ...patch };
    return { output: out, attestation: signEnvelope(attestation, provider) };
  };
  return { issuer, credentialRoot, issuerFixture, provider, registry, trust, credential, makeResponse, ledger: options.ledger ?? new InMemoryReplayLedger() };
}
class FixtureProvider implements AttestedProviderAdapter {
  constructor(readonly factory: (input: ModelAdapterInput) => AttestedProviderResponse) {}
  async invokeAttested(request: ModelAdapterInput): Promise<AttestedProviderResponse> { return this.factory(request); }
}

test('sovereign provider boundary verifies credential, full input/output binding and records replay proof', async () => {
  const h = setup(); const request = input(); const boundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, h.ledger, new FixtureProvider((row) => h.makeResponse(row)), egressPolicy, () => now);
  const result = await boundary.invoke(request); assert.match(result.limitations.join(','), /provider-attestation-verified/);
  const verification = boundary.lastVerification()!; assert.equal(verification.status, 'VERIFIED_PROVIDER_ATTESTATION'); assert.equal(verification.providerId, 'provider-a'); assert.match(verification.credentialDigest, /^[a-f0-9]{64}$/);
});

test('provider boundary rejects signature, provider/model, tenant, request, input, policy and output substitution', async () => {
  const request = input();
  const cases: Array<{ name: string; response: (h: ReturnType<typeof setup>) => AttestedProviderResponse; error: RegExp }> = [
    { name: 'provider identity', response: (h) => h.makeResponse(request, output({ provider: 'provider-b' })), error: /not_credentialed|output_identity/ },
    { name: 'model', response: (h) => h.makeResponse(request, output({ model: 'other-model' })), error: /not_authorized/ },
    { name: 'tenant', response: (h) => h.makeResponse(request, output(), { tenantId: 'tenant-2' }), error: /not_authorized|request_binding/ },
    { name: 'request', response: (h) => h.makeResponse(request, output(), { requestDigest: 'wrong' }), error: /request_binding/ },
    { name: 'input', response: (h) => h.makeResponse(request, output(), { inputDigest: sha256('wrong') }), error: /input_digest/ },
    { name: 'policy', response: (h) => h.makeResponse(request, output(), { policyDigest: sha256('wrong') }), error: /policy_digest/ },
    { name: 'output', response: (h) => { const signed = h.makeResponse(request); return { output: { ...signed.output, output: 'mutated' }, attestation: signed.attestation }; }, error: /output_digest/ },
    { name: 'nonsemantic output', response: (h) => { const signed = h.makeResponse(request); return { output: { ...signed.output, limitations: [...signed.output.limitations, 'mutated-after-attestation'] }, attestation: signed.attestation }; }, error: /output_digest/ },
  ];
  for (const row of cases) { const h = setup(); const boundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, h.ledger, new FixtureProvider(() => row.response(h)), egressPolicy, () => now); await assert.rejects(boundary.invoke(request), row.error, row.name); }
  const h = setup(); const rogue = generateSigningIdentity('rogue-provider'); h.registry.register(rogue.keyId, rogue.publicKey); const valid = h.makeResponse(request); const forged = { ...valid, attestation: signEnvelope(valid.attestation.payload, rogue) };
  await assert.rejects(new SovereignAttestedProviderBoundary(h.registry, h.trust, h.ledger, new FixtureProvider(() => forged), egressPolicy, () => now).invoke(request), /signature_invalid|issuer_mismatch/);
});

test('provider credential authority rejects wrong tenant, inactive credential and unregistered provider', async () => {
  const wrongTenant = setup({ tenantIds: ['tenant-2'] }); await assert.rejects(new SovereignAttestedProviderBoundary(wrongTenant.registry, wrongTenant.trust, wrongTenant.ledger, new FixtureProvider((row) => wrongTenant.makeResponse(row)), egressPolicy, () => now).invoke(input()), /not_authorized/);
  const revoked = setup({ revokedAt: now.toISOString() }); await assert.rejects(new SovereignAttestedProviderBoundary(revoked.registry, revoked.trust, revoked.ledger, new FixtureProvider((row) => revoked.makeResponse(row)), egressPolicy, () => now).invoke(input()), /credential_inactive/);
  const issuer = generateSigningIdentity('issuer-only'); const root = generateSigningIdentity('issuer-only-root'); const provider = generateSigningIdentity('provider-not-registered'); const registry = new KeyRegistry();
  const issuerFixture = registerCredentialIssuerFixture({ registry, root, issuer, kinds: ['PROVIDER'], tenantIds: ['t'], scopes: ['model.invoke'], now }); const trust = new ProviderTrustRegistry(registry, issuerFixture.trust, () => now);
  assert.throws(() => trust.register(signEnvelope({ credentialId: 'c', providerId: 'p', providerKeyId: provider.keyId, allowedModels: ['m'], tenantIds: ['t'], scopes: ['model.invoke'], issuedAt: now.toISOString(), expiresAt: new Date(now.getTime()+1000).toISOString(), issuerId: issuer.keyId, issuerGrantDigest: issuerFixture.grantDigest }, issuer)), /key_not_registered/);
});

test('provider attestation replay is rejected across restart with persistent replay ledger', async () => {
  const root = mkdtempSync(join(tmpdir(), 'provider-replay-v31-')); const h = setup({ ledger: new FileReplayLedger(root) }); const request = input(); const response = h.makeResponse(request);
  const first = new SovereignAttestedProviderBoundary(h.registry, h.trust, h.ledger, new FixtureProvider(() => response), egressPolicy, () => now); await first.invoke(request);
  const reopened = new SovereignAttestedProviderBoundary(h.registry, h.trust, new FileReplayLedger(root), new FixtureProvider(() => response), egressPolicy, () => new Date(now.getTime()+1));
  await assert.rejects(reopened.invoke(request), /attestation_replay/);
});

test('provider attestation rejects malformed or future timing and issuer mismatch', async () => {
  const request = input(); const h = setup();
  for (const patch of [{ finishedAt: 'bad' }, { startedAt: new Date(now.getTime()+10).toISOString(), finishedAt: now.toISOString() }, { issuedAt: new Date(now.getTime()+600_000).toISOString() }]) {
    const boundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, new InMemoryReplayLedger(), new FixtureProvider(() => h.makeResponse(request, output(), patch)), egressPolicy, () => now);
    await assert.rejects(boundary.invoke(request), /time_invalid/);
  }
  const response = h.makeResponse(request); const mismatch = { ...response, attestation: { ...response.attestation, payload: { ...response.attestation.payload, providerKeyId: 'different' } } };
  await assert.rejects(new SovereignAttestedProviderBoundary(h.registry, h.trust, new InMemoryReplayLedger(), new FixtureProvider(() => mismatch), egressPolicy, () => now).invoke(request), /signature_invalid|issuer_mismatch/);
});

test('verified provider proof propagates into the signed governed model receipt without granting correctness', async () => {
  const h = setup(); const requestInput = input(); const providerOutput = output({ workGraph: [{ nodeId: 'analysis', kind: 'ANALYSIS', summary: 'Analyze provider result', dependsOn: [], requestedTool: 'repository.read', payload: {} }] }); const boundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, h.ledger, new FixtureProvider((row) => h.makeResponse(row, providerOutput)), egressPolicy, () => now);
  const authority = generateSigningIdentity('provider-boundary-authority'); const receiptSigner = generateSigningIdentity('provider-boundary-receipt'); h.registry.register(authority.keyId, authority.publicKey); h.registry.register(receiptSigner.keyId, receiptSigner.publicKey);
  const grant = signEnvelope({ grantId: 'provider-grant', tenantId: requestInput.tenantId, subjectId: requestInput.subjectId, scopes: ['model.analyze'], issuedAt: new Date(now.getTime()-1000).toISOString(), expiresAt: new Date(now.getTime()+60_000).toISOString(), issuer: 'kernel' }, authority);
  const { GovernedModelOrchestrator } = await import('../src/ai/governed-model-orchestrator.js');
  const orchestrator = new GovernedModelOrchestrator(h.registry, receiptSigner, boundary);
  const receipt = await orchestrator.execute({ requestId: 'provider-governed-run', tenantId: requestInput.tenantId, subjectId: requestInput.subjectId, requesterId: 'operator', purpose: requestInput.purpose, objective: requestInput.objective, authority: grant, allowedTools: requestInput.allowedTools, context: [{ contextId: 'c', source: 'registry', trust: 'TRUSTED', priority: 1, content: 'trusted context' }], budget: requestInput.budget, createdAt: now.toISOString() }, now);
  assert.equal(receipt.payload.providerBoundaryProof?.status, 'VERIFIED_PROVIDER_ATTESTATION');
  assert.equal(receipt.payload.providerBoundaryProof?.limitation, 'provider-attestation-proves-binding-not-model-correctness');
  assert.equal((receipt.payload.evidence.payload as { providerBoundaryProof?: { status?: string } }).providerBoundaryProof?.status, 'VERIFIED_PROVIDER_ATTESTATION');
  assert.equal(receipt.payload.status, 'PROPOSAL_ONLY');
});

test('egress policy blocks secrets, untrusted context, unknown sources and disclosure budget before provider invocation', async () => {
  const h = setup(); let calls = 0; const provider = new FixtureProvider((row) => { calls += 1; return h.makeResponse(row); });
  const boundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, h.ledger, provider, egressPolicy, () => now);
  await assert.rejects(boundary.invoke(input({ context: [{ contextId: 'secret', source: 'registry', trust: 'TRUSTED', priority: 1, content: 'api_key=supersecretvalue' }] })), /egress_secret_detected/);
  await assert.rejects(boundary.invoke(input({ context: [{ contextId: 'untrusted', source: 'registry', trust: 'UNTRUSTED', priority: 1, content: 'ordinary text' }] })), /egress_untrusted_context_denied/);
  await assert.rejects(boundary.invoke(input({ context: [{ contextId: 'unknown', source: 'unknown-source', trust: 'TRUSTED', priority: 1, content: 'ordinary text' }] })), /egress_source_not_allowed/);
  const tiny = { ...egressPolicy, maxDisclosedChars: 1 };
  await assert.rejects(new SovereignAttestedProviderBoundary(h.registry, h.trust, new InMemoryReplayLedger(), provider, tiny, () => now).invoke(input()), /egress_budget_exceeded/);
  assert.equal(calls, 0);
});

test('provider attestation binds the exact disclosure digest and receipt separates interaction from mutation', async () => {
  const h = setup(); const request = input({ context: [{ contextId: 'c', source: 'registry', trust: 'TRUSTED', priority: 1, content: 'safe context' }] });
  const mismatched = h.makeResponse(request, output(), { disclosureDigest: sha256('other-disclosure') });
  await assert.rejects(new SovereignAttestedProviderBoundary(h.registry, h.trust, h.ledger, new FixtureProvider(() => mismatched), egressPolicy, () => now).invoke(request), /disclosure_digest_mismatch/);
  const valid = h.makeResponse(request);
  const boundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, new InMemoryReplayLedger(), new FixtureProvider(() => valid), egressPolicy, () => now);
  const result = await boundary.invoke(request); assert.equal(result.providerBoundaryProof?.externalInteractionsExecuted, 1); assert.equal(result.providerBoundaryProof?.externalMutationsExecuted, 0);
});

test('signed provider credential revocation is credential-bound and blocks later provider use', async () => {
  const h = setup(); const revocation = signEnvelope({ revocationId: 'revoke-provider-a', providerId: 'provider-a', credentialDigest: sha256(h.credential), reason: 'provider-compromise', revokedAt: now.toISOString(), issuerId: h.issuer.keyId }, h.issuer);
  h.trust.registerRevocation(revocation); h.trust.registerRevocation(revocation);
  const boundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, h.ledger, new FixtureProvider((row) => h.makeResponse(row)), egressPolicy, () => now);
  await assert.rejects(boundary.invoke(input()), /provider_credential_revoked/);
  const substituted = signEnvelope({ ...revocation.payload, credentialDigest: sha256('different') }, h.issuer);
  assert.throws(() => h.trust.registerRevocation(substituted), /credential_binding_invalid/);
});

test('persisted external-provider receipt is revalidated after restart and rejected after credential revocation without a second model call', async () => {
  const h = setup(); const providerOutput = output({ workGraph: [{ nodeId: 'analysis', kind: 'ANALYSIS', summary: 'Analyze', dependsOn: [], requestedTool: 'repository.read', payload: {} }] }); let calls = 0;
  const provider = new FixtureProvider((row) => { calls += 1; return h.makeResponse(row, providerOutput); });
  const boundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, h.ledger, provider, egressPolicy, () => now);
  const authority = generateSigningIdentity('restart-authority'); const receiptSigner = generateSigningIdentity('restart-receipt'); h.registry.register(authority.keyId, authority.publicKey); h.registry.register(receiptSigner.keyId, receiptSigner.publicKey);
  const grant = signEnvelope({ grantId: 'restart-grant', tenantId: 'tenant-1', subjectId: 'repo:alpha', scopes: ['model.analyze'], issuedAt: new Date(now.getTime()-1000).toISOString(), expiresAt: new Date(now.getTime()+60_000).toISOString(), issuer: 'kernel' }, authority);
  const request = { requestId: 'external-restart', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', purpose: 'ANALYZE' as const, objective: 'analyze safely', authority: grant, allowedTools: ['repository.read'] as const, context: [{ contextId: 'c', source: 'registry', trust: 'TRUSTED' as const, priority: 1, content: 'safe context' }], budget: input().budget, createdAt: now.toISOString() };
  const root = mkdtempSync(join(tmpdir(), 'provider-model-replay-v31-')); const { FileModelRunStore, GovernedModelOrchestrator } = await import('../src/ai/governed-model-orchestrator.js');
  await new GovernedModelOrchestrator(h.registry, receiptSigner, boundary, new FileModelRunStore(root)).execute(request, now); assert.equal(calls, 1);
  h.trust.registerRevocation(signEnvelope({ revocationId: 'provider-revoked-after-run', providerId: 'provider-a', credentialDigest: sha256(h.credential), reason: 'post-run-compromise', revokedAt: new Date(now.getTime()+10).toISOString(), issuerId: h.issuer.keyId }, h.issuer));
  const reopenedProvider = new FixtureProvider(() => { calls += 1; throw new Error('provider_must_not_be_called_on_replay'); });
  const reopenedBoundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, new FileReplayLedger(mkdtempSync(join(tmpdir(), 'provider-replay-validator-'))), reopenedProvider, egressPolicy, () => new Date(now.getTime()+20));
  await assert.rejects(new GovernedModelOrchestrator(h.registry, receiptSigner, reopenedBoundary, new FileModelRunStore(root)).execute(request, new Date(now.getTime()+20)), /provider_credential_revoked/);
  assert.equal(calls, 1);
});

test('persisted provider receipt cannot be replayed through an adapter that lacks current provider validation', async () => {
  const h = setup(); const providerOutput = output({ workGraph: [{ nodeId: 'analysis', kind: 'ANALYSIS', summary: 'Analyze', dependsOn: [], requestedTool: 'repository.read', payload: {} }] });
  const boundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, h.ledger, new FixtureProvider((row) => h.makeResponse(row, providerOutput)), egressPolicy, () => now);
  const authority = generateSigningIdentity('validator-authority'); const receiptSigner = generateSigningIdentity('validator-receipt'); h.registry.register(authority.keyId, authority.publicKey); h.registry.register(receiptSigner.keyId, receiptSigner.publicKey);
  const grant = signEnvelope({ grantId: 'validator-grant', tenantId: 'tenant-1', subjectId: 'repo:alpha', scopes: ['model.analyze'], issuedAt: new Date(now.getTime()-1000).toISOString(), expiresAt: new Date(now.getTime()+60_000).toISOString(), issuer: 'kernel' }, authority);
  const request = { requestId: 'validator-required', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', purpose: 'ANALYZE' as const, objective: 'analyze safely', authority: grant, allowedTools: ['repository.read'] as const, context: [{ contextId: 'c', source: 'registry', trust: 'TRUSTED' as const, priority: 1, content: 'safe context' }], budget: input().budget, createdAt: now.toISOString() };
  const root = mkdtempSync(join(tmpdir(), 'provider-validator-required-v31-')); const { FileModelRunStore, GovernedModelOrchestrator } = await import('../src/ai/governed-model-orchestrator.js');
  await new GovernedModelOrchestrator(h.registry, receiptSigner, boundary, new FileModelRunStore(root)).execute(request, now);
  const ordinaryAdapter = { invoke: async () => { throw new Error('must_not_invoke'); } };
  await assert.rejects(new GovernedModelOrchestrator(h.registry, receiptSigner, ordinaryAdapter, new FileModelRunStore(root)).execute(request, now), /provider_replay_validator_required/);
});

test('self-asserted provider proof from an adapter without canonical revalidation is rejected before receipt signing', async () => {
  const authority = generateSigningIdentity('provider-self-assert-authority'); const receiptSigner = generateSigningIdentity('provider-self-assert-receipt'); const registry = new KeyRegistry(); registry.register(authority.keyId, authority.publicKey); registry.register(receiptSigner.keyId, receiptSigner.publicKey);
  const request = { requestId: 'self-asserted-proof', tenantId: 'tenant-1', subjectId: 'repo:alpha', requesterId: 'operator', purpose: 'ANALYZE' as const, objective: 'analyze', authority: signEnvelope({ grantId: 'g', tenantId: 'tenant-1', subjectId: 'repo:alpha', scopes: ['model.analyze'], issuedAt: new Date(now.getTime()-1000).toISOString(), expiresAt: new Date(now.getTime()+60_000).toISOString(), issuer: 'kernel' }, authority), allowedTools: ['repository.read'] as const, context: [], budget: { maxContextChars: 1000, maxOutputChars: 1000, maxClaims: 5, maxGraphNodes: 5, maxToolProposals: 2, maxLatencyMs: 1000 }, createdAt: now.toISOString() };
  const fakeProof = { credentialDigest: sha256('fake'), attestationDigest: sha256('fake-attestation'), replayKeyDigest: sha256('fake-replay'), disclosureDigest: sha256('fake-disclosure'), externalInteractionsExecuted: 1 as const, externalMutationsExecuted: 0 as const, providerId: 'provider-a', model: 'sol-5.6-qualified', verifiedAt: now.toISOString(), status: 'VERIFIED_PROVIDER_ATTESTATION' as const, limitation: 'provider-attestation-proves-binding-not-model-correctness' as const, signedAttestation: signEnvelope({ fake: true }, receiptSigner) };
  const adapter = { invoke: async () => output({ providerBoundaryProof: fakeProof }) };
  await assert.rejects(new GovernedModelOrchestrator(registry, receiptSigner, adapter, new FileModelRunStore(mkdtempSync(join(tmpdir(), 'self-asserted-provider-proof-')))).execute(request, now), /provider_boundary_validator_required/);
});
