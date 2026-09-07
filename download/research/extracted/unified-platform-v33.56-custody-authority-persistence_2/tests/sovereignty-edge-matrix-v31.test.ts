import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { InMemoryReplayLedger } from '../src/platform/replay-ledger.js';
import { SovereignAttestedProviderBoundary, providerDisclosureDigest, type AttestedProviderResponse, type ProviderEgressPolicy } from '../src/ai/provider-sovereignty.js';
import { ProviderTrustRegistry, type ProviderCredential, type ProviderCredentialRevocation } from '../src/security/provider-trust.js';
import type { ModelAdapterInput, ModelAdapterOutput } from '../src/ai/governed-model-orchestrator.js';
import {
  ReviewerTrustRegistry, type ReviewerCredential, type ReviewerCredentialRevocation,
} from '../src/security/reviewer-trust.js';
import { withSovereignFileLease, withSovereignFileLeaseAsync } from '../src/persistence/sovereign-file-lease.js';
import { registerCredentialIssuerFixture } from './credential-issuer-fixtures.js';

const now = new Date('2026-07-17T22:30:00.000Z');
const policy: ProviderEgressPolicy = { allowedContextSources: ['registry'], allowUntrustedContext: false, maxDisclosedChars: 1_000, secretHandling: 'REJECT_DETECTED_SECRETS' };
function modelInput(patch: Partial<ModelAdapterInput> = {}): ModelAdapterInput {
  return { requestDigest: sha256('request'), tenantId: 'tenant-1', subjectId: 'repo:alpha', purpose: 'ANALYZE', objective: 'analyze', allowedTools: ['repository.read'], context: [], budget: { maxContextChars: 500, maxOutputChars: 500, maxClaims: 2, maxGraphNodes: 2, maxToolProposals: 1, maxLatencyMs: 100 }, ...patch };
}
function modelOutput(patch: Partial<ModelAdapterOutput> = {}): ModelAdapterOutput {
  return { provider: 'provider-a', model: 'model-a', output: 'proposal', claims: [], workGraph: [], usage: { inputChars: 0, outputChars: 8, latencyMs: 1 }, startedAt: now.toISOString(), finishedAt: new Date(now.getTime() + 1).toISOString(), limitations: [], ...patch };
}
function providerHarness() {
  const issuer = generateSigningIdentity('provider-edge-issuer'); const root = generateSigningIdentity('provider-edge-root'); const provider = generateSigningIdentity('provider-edge-key'); const registry = new KeyRegistry();
  registry.register(provider.keyId, provider.publicKey); const issuerFixture = registerCredentialIssuerFixture({ registry, root, issuer, kinds: ['PROVIDER'], tenantIds: ['tenant-1'], scopes: ['model.invoke'], now });
  const trust = new ProviderTrustRegistry(registry, issuerFixture.trust, () => now);
  const material: ProviderCredential = { credentialId: 'provider-credential', providerId: 'provider-a', providerKeyId: provider.keyId, allowedModels: ['model-a'], tenantIds: ['tenant-1'], scopes: ['model.invoke'], issuedAt: new Date(now.getTime() - 1_000).toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), issuerId: issuer.keyId, issuerGrantDigest: issuerFixture.grantDigest };
  const credential = signEnvelope(material, issuer); trust.register(credential);
  const response = (input: ModelAdapterInput, output = modelOutput(), patch: Record<string, unknown> = {}): AttestedProviderResponse => ({ output, attestation: signEnvelope({ attestationId: 'att', nonce: 'nonce', providerId: output.provider, providerKeyId: provider.keyId, model: output.model, tenantId: input.tenantId, subjectId: input.subjectId, requestDigest: input.requestDigest, inputDigest: sha256(input), policyDigest: sha256({ purpose: input.purpose, allowedTools: [...input.allowedTools].sort(), budget: input.budget }), outputDigest: sha256(output), semanticOutputDigest: sha256({ output: output.output, claims: output.claims, workGraph: output.workGraph }), disclosureDigest: providerDisclosureDigest(input, policy), startedAt: output.startedAt, finishedAt: output.finishedAt, issuedAt: new Date(now.getTime() + 1).toISOString(), ...patch }, provider) });
  return { issuer, root, issuerFixture, provider, registry, trust, material, credential, response };
}

test('provider credential validation and registration cover every malformed and conflict branch', () => {
  const h = providerHarness(); h.trust.register(h.credential);
  const altered = signEnvelope({ ...h.material, allowedModels: ['model-b'] }, h.issuer);
  assert.throws(() => h.trust.register(altered), /credential_conflict/);
  const rogue = generateSigningIdentity('provider-edge-rogue'); h.registry.register(rogue.keyId, rogue.publicKey);
  const cases: Array<[Partial<ProviderCredential>, RegExp, typeof h.issuer]> = [
    [{ issuerId: rogue.keyId }, /issuer_mismatch/, h.issuer],
    [{ credentialId: '' }, /identity_invalid/, h.issuer],
    [{ providerId: '' }, /identity_invalid/, h.issuer],
    [{ providerKeyId: '' }, /identity_invalid|key_not_registered/, h.issuer],
    [{ allowedModels: [] }, /scope_invalid/, h.issuer],
    [{ tenantIds: [] }, /scope_invalid/, h.issuer],
    [{ allowedModels: ['model-a','model-a'] }, /scope_invalid/, h.issuer],
    [{ tenantIds: ['tenant-1','tenant-1'] }, /scope_invalid/, h.issuer],
    [{ allowedModels: [''] }, /scope_invalid/, h.issuer],
    [{ issuedAt: 'bad' }, /time_invalid/, h.issuer],
    [{ expiresAt: h.material.issuedAt }, /time_invalid/, h.issuer],
    [{ revokedAt: new Date(Date.parse(h.material.issuedAt) - 1).toISOString() }, /revocation_invalid/, h.issuer],
  ];
  for (const [patch, error, signer] of cases) {
    const trust = new ProviderTrustRegistry(h.registry, h.trust.issuerTrust, () => now); const signed = signEnvelope({ ...h.material, ...patch }, signer);
    assert.throws(() => trust.register(signed), error);
  }
  const badSignature = { ...h.credential, signature: `${h.credential.signature.slice(0, -2)}aa` };
  assert.throws(() => new ProviderTrustRegistry(h.registry, h.trust.issuerTrust, () => now).register(badSignature), /signature_invalid/);
});

test('provider authorization and signed revocation cover key, time, scope, issuer, conflict and idempotency branches', () => {
  const h = providerHarness();
  assert.throws(() => h.trust.authorize({ providerId: 'missing', providerKeyId: h.provider.keyId, model: 'model-a', tenantId: 'tenant-1', at: now.toISOString() }), /not_credentialed/);
  assert.throws(() => h.trust.authorize({ providerId: 'provider-a', providerKeyId: h.provider.keyId, model: 'model-a', tenantId: 'tenant-1', at: 'bad' }), /time_invalid/);
  assert.throws(() => h.trust.authorize({ providerId: 'provider-a', providerKeyId: 'wrong', model: 'model-a', tenantId: 'tenant-1', at: now.toISOString() }), /key_binding_invalid/);
  assert.throws(() => h.trust.authorize({ providerId: 'provider-a', providerKeyId: h.provider.keyId, model: 'other', tenantId: 'tenant-1', at: now.toISOString() }), /not_authorized/);
  assert.throws(() => h.trust.authorize({ providerId: 'provider-a', providerKeyId: h.provider.keyId, model: 'model-a', tenantId: 'tenant-2', at: now.toISOString() }), /not_authorized/);
  assert.throws(() => h.trust.authorize({ providerId: 'provider-a', providerKeyId: h.provider.keyId, model: 'model-a', tenantId: 'tenant-1', at: new Date(Date.parse(h.material.issuedAt) - 1).toISOString() }), /credential_inactive/);
  assert.throws(() => h.trust.authorize({ providerId: 'provider-a', providerKeyId: h.provider.keyId, model: 'model-a', tenantId: 'tenant-1', at: h.material.expiresAt }), /credential_inactive/);
  const revocationMaterial: ProviderCredentialRevocation = { revocationId: 'provider-revoke', providerId: 'provider-a', credentialDigest: sha256(h.credential), reason: 'compromise', revokedAt: now.toISOString(), issuerId: h.issuer.keyId };
  const revocation = signEnvelope(revocationMaterial, h.issuer); h.trust.registerRevocation(revocation); h.trust.registerRevocation(revocation);
  assert.throws(() => h.trust.authorize({ providerId: 'provider-a', providerKeyId: h.provider.keyId, model: 'model-a', tenantId: 'tenant-1', at: now.toISOString() }), /credential_revoked/);
  const conflict = signEnvelope({ ...revocationMaterial, reason: 'different' }, h.issuer); assert.throws(() => h.trust.registerRevocation(conflict), /revocation_conflict/);
  const fresh = providerHarness();
  const malformed: Array<[Partial<ProviderCredentialRevocation>, RegExp]> = [
    [{ revocationId: '' }, /identity_invalid/], [{ providerId: 'missing' }, /credential_not_found|binding_invalid/], [{ issuerId: 'wrong' }, /issuer_mismatch/],
    [{ credentialDigest: sha256('wrong') }, /binding_invalid/], [{ revokedAt: 'bad' }, /time_invalid/], [{ revokedAt: new Date(Date.parse(fresh.material.issuedAt)-1).toISOString() }, /time_invalid/],
  ];
  for (const [patch, error] of malformed) assert.throws(() => fresh.trust.registerRevocation(signEnvelope({ ...revocationMaterial, credentialDigest: sha256(fresh.credential), issuerId: fresh.issuer.keyId, ...patch }, fresh.issuer)), error);
});

test('provider egress policy covers malformed policies, objective and context secrets, source, trust and exact budget boundary', () => {
  const base = modelInput({ context: [{ contextId: 'c', source: 'registry', trust: 'TRUSTED', priority: 1, content: 'ok' }] });
  const policies: Array<[ProviderEgressPolicy, RegExp]> = [
    [{ ...policy, maxDisclosedChars: -1 }, /policy_invalid/], [{ ...policy, maxDisclosedChars: 1.5 }, /policy_invalid/],
    [{ ...policy, allowedContextSources: [] }, /policy_invalid/], [{ ...policy, allowedContextSources: ['registry','registry'] }, /policy_invalid/],
    [{ ...policy, allowedContextSources: [''] }, /policy_invalid/], [{ ...policy, secretHandling: 'bad' as never }, /policy_invalid/],
  ];
  for (const [row, error] of policies) assert.throws(() => providerDisclosureDigest(base, row), error);
  assert.throws(() => providerDisclosureDigest(base, { ...policy, maxDisclosedChars: 1 }), /budget_exceeded/);
  assert.throws(() => providerDisclosureDigest(modelInput({ context: [{ contextId: 'c', source: 'other', trust: 'TRUSTED', priority: 1, content: 'ok' }] }), policy), /source_not_allowed/);
  assert.throws(() => providerDisclosureDigest(modelInput({ context: [{ contextId: 'c', source: 'registry', trust: 'UNTRUSTED', priority: 1, content: 'ok' }] }), policy), /untrusted_context_denied/);
  for (const secret of ['password=abcdefghi','api_key: abcdefghi','token=abcdefghi','-----BEGIN PRIVATE KEY-----','AKIAABCDEFGHIJKLMNOP']) {
    assert.throws(() => providerDisclosureDigest(modelInput({ objective: secret }), policy), /secret_detected/);
    assert.throws(() => providerDisclosureDigest(modelInput({ context: [{ contextId: 'c', source: 'registry', trust: 'TRUSTED', priority: 1, content: secret }] }), policy), /secret_detected/);
  }
  const exact = modelInput({ objective: 'a', context: [{ contextId: 'c', source: 'registry', trust: 'UNTRUSTED', priority: 1, content: 'b' }] });
  assert.match(providerDisclosureDigest(exact, { ...policy, allowUntrustedContext: true, maxDisclosedChars: 2 }), /^[a-f0-9]{64}$/);
});

test('provider boundary covers no-verification, invalid clock, identity, semantic digest, disclosure and persisted replay branches', async () => {
  const h = providerHarness(); const request = modelInput(); const good = h.response(request);
  const boundary = new SovereignAttestedProviderBoundary(h.registry, h.trust, new InMemoryReplayLedger(), { invokeAttested: async () => good }, policy, () => now);
  assert.equal(boundary.lastVerification(), undefined);
  await assert.rejects(new SovereignAttestedProviderBoundary(h.registry, h.trust, new InMemoryReplayLedger(), { invokeAttested: async () => good }, policy, () => new Date(Number.NaN)).invoke(request), /boundary_time_invalid/);
  for (const patch of [{ attestationId: '' }, { nonce: '' }, { subjectId: '' }]) {
    const response = h.response(request, modelOutput(), patch); await assert.rejects(new SovereignAttestedProviderBoundary(h.registry, h.trust, new InMemoryReplayLedger(), { invokeAttested: async () => response }, policy, () => now).invoke(request), /identity_invalid/);
  }
  const semantic = h.response(request, modelOutput(), { semanticOutputDigest: sha256('wrong') });
  await assert.rejects(new SovereignAttestedProviderBoundary(h.registry, h.trust, new InMemoryReplayLedger(), { invokeAttested: async () => semantic }, policy, () => now).invoke(request), /semantic_output_digest_mismatch/);
  const disclosure = h.response(request, modelOutput(), { disclosureDigest: sha256('wrong') });
  await assert.rejects(new SovereignAttestedProviderBoundary(h.registry, h.trust, new InMemoryReplayLedger(), { invokeAttested: async () => disclosure }, policy, () => now).invoke(request), /disclosure_digest_mismatch/);
  const verified = await boundary.invoke(request);
  assert.throws(() => boundary.validatePersistedReceipt({ tenantId: request.tenantId, provider: verified.provider, model: verified.model, requestDigest: request.requestDigest, output: verified.output, claims: [{ ...verified.claims[0]!, statement: 'mutated after persistence' }], workGraph: verified.workGraph, providerBoundaryProof: verified.providerBoundaryProof } as never, now), /replay_semantic_output_mismatch/);
  assert.throws(() => boundary.validatePersistedReceipt({ providerBoundaryProof: undefined } as never, now), /replay_proof_required/);
  assert.throws(() => boundary.validatePersistedReceipt({ providerBoundaryProof: {} } as never, new Date(Number.NaN)), /boundary_time_invalid/);
});

function reviewerHarness() {
  const issuer = generateSigningIdentity('reviewer-edge-issuer'); const root = generateSigningIdentity('reviewer-edge-root'); const reviewer = generateSigningIdentity('reviewer-edge-key'); const registry = new KeyRegistry(); registry.register(reviewer.keyId, reviewer.publicKey); const issuerFixture = registerCredentialIssuerFixture({ registry, root, issuer, kinds: ['REVIEWER'], tenantIds: ['tenant-1'], scopes: ['campaign.review'], now }); const trust = new ReviewerTrustRegistry(registry, issuerFixture.trust, () => now);
  const material: ReviewerCredential = { credentialId: 'reviewer-credential', reviewerKeyId: reviewer.keyId, organizationId: 'org-a', roles: ['INDEPENDENT_REVIEWER'], tenantIds: ['tenant-1'], scopes: ['campaign.review'], issuedAt: new Date(now.getTime()-1_000).toISOString(), expiresAt: new Date(now.getTime()+60_000).toISOString(), issuerId: issuer.keyId, issuerGrantDigest: issuerFixture.grantDigest };
  const credential = signEnvelope(material, issuer); trust.register(credential); return { issuer, reviewer, registry, trust, material, credential };
}

test('reviewer credential and revocation validation cover conflicts, malformed roles, scopes, times and authorization boundaries', () => {
  const h = reviewerHarness(); h.trust.register(h.credential); assert.throws(() => h.trust.register(signEnvelope({ ...h.material, organizationId: 'org-b' }, h.issuer)), /credential_conflict/);
  const malformed: Array<[Partial<ReviewerCredential>, RegExp]> = [
    [{ credentialId: '' }, /identity_invalid/], [{ organizationId: '' }, /identity_invalid/], [{ roles: [] }, /roles_invalid/],
    [{ roles: ['INDEPENDENT_REVIEWER','INDEPENDENT_REVIEWER'] }, /roles_invalid/], [{ roles: ['BAD' as never] }, /roles_invalid/],
    [{ tenantIds: [] }, /scope_invalid/], [{ scopes: [] }, /scope_invalid/], [{ tenantIds: [''] }, /scope_invalid/],
    [{ issuedAt: 'bad' }, /time_invalid/], [{ expiresAt: h.material.issuedAt }, /time_invalid/], [{ revokedAt: new Date(Date.parse(h.material.issuedAt)-1).toISOString() }, /revocation_invalid/],
  ];
  for (const [patch, error] of malformed) assert.throws(() => new ReviewerTrustRegistry(h.registry, h.trust.issuerTrust, () => now).register(signEnvelope({ ...h.material, ...patch }, h.issuer)), error);
  assert.throws(() => h.trust.authorize({ reviewerKeyId: 'missing', tenantId: 'tenant-1', scope: 'campaign.review', role: 'INDEPENDENT_REVIEWER', at: now.toISOString() }), /not_credentialed/);
  assert.throws(() => h.trust.authorize({ reviewerKeyId: h.reviewer.keyId, tenantId: 'tenant-1', scope: 'campaign.review', role: 'INDEPENDENT_REVIEWER', at: 'bad' }), /time_invalid/);
  assert.throws(() => h.trust.authorize({ reviewerKeyId: h.reviewer.keyId, tenantId: 'tenant-2', scope: 'campaign.review', role: 'INDEPENDENT_REVIEWER', at: now.toISOString() }), /not_authorized/);
  assert.throws(() => h.trust.authorize({ reviewerKeyId: h.reviewer.keyId, tenantId: 'tenant-1', scope: 'campaign.review', role: 'INDEPENDENT_REVIEWER', at: h.material.expiresAt }), /credential_inactive/);
  const revocationMaterial: ReviewerCredentialRevocation = { revocationId: 'review-revoke', reviewerKeyId: h.reviewer.keyId, credentialDigest: sha256(h.credential), reason: 'conflict', revokedAt: now.toISOString(), issuerId: h.issuer.keyId };
  const revocation = signEnvelope(revocationMaterial, h.issuer); h.trust.registerRevocation(revocation); h.trust.registerRevocation(revocation);
  assert.throws(() => h.trust.authorize({ reviewerKeyId: h.reviewer.keyId, tenantId: 'tenant-1', scope: 'campaign.review', role: 'INDEPENDENT_REVIEWER', at: now.toISOString() }), /credential_revoked/);
  assert.throws(() => h.trust.registerRevocation(signEnvelope({ ...revocationMaterial, reason: 'different' }, h.issuer)), /revocation_conflict/);
});

test('sovereign file lease covers option validation, async release, malformed and remote stale records, and identity mismatch recovery', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lease-edge-v31-'));
  for (const options of [{ timeoutMs: 0 }, { staleAfterMs: -1 }, { pollMs: 1.5 }]) assert.throws(() => withSovereignFileLease(join(root, crypto.randomUUID()), () => undefined, options), /file_lease_.*_invalid/);
  const asyncPath = join(root, 'async.lock'); assert.equal(await withSovereignFileLeaseAsync(asyncPath, async () => 'ok', { timeoutMs: 100, pollMs: 1 }), 'ok');
  for (const [name, record] of [
    ['malformed', '{bad json'],
    ['remote', JSON.stringify({ version: 1, token: 'remote', pid: 999999999, hostname: 'remote-host', acquiredAt: new Date(now.getTime()-60_000).toISOString() })],
    ['boot-mismatch', JSON.stringify({ version: 1, token: 'boot', pid: process.pid, hostname: hostname(), bootId: 'wrong-boot', acquiredAt: new Date(now.getTime()-60_000).toISOString() })],
    ['start-mismatch', JSON.stringify({ version: 1, token: 'start', pid: process.pid, hostname: hostname(), processStartTicks: 'wrong', acquiredAt: new Date(now.getTime()-60_000).toISOString() })],
  ] as const) {
    const path = join(root, `${name}.lock`); writeFileSync(path, `${record}\n`); const old = new Date(Date.now()-60_000); utimesSync(path, old, old);
    if (name === 'remote') assert.throws(() => withSovereignFileLease(path, () => undefined, { timeoutMs: 20, staleAfterMs: 1, pollMs: 2 }), /file_lease_timeout/);
    else assert.equal(withSovereignFileLease(path, () => name, { timeoutMs: 100, staleAfterMs: 1, pollMs: 1 }), name);
  }
  const ownership = join(root, 'ownership.lock'); assert.throws(() => withSovereignFileLease(ownership, () => writeFileSync(ownership, `${JSON.stringify({ version: 1, token: 'other', pid: process.pid, hostname: hostname(), acquiredAt: now.toISOString() })}\n`)), /ownership_lost/); assert.equal(JSON.parse(readFileSync(ownership,'utf8')).token, 'other');
});
