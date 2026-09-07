import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { InMemoryReplayLedger } from '../src/platform/replay-ledger.js';
import { SovereignAttestedProviderBoundary, providerDisclosureDigest, type ProviderEgressPolicy } from '../src/ai/provider-sovereignty.js';
import { ProviderTrustRegistry, type ProviderCredential } from '../src/security/provider-trust.js';
import type { ModelAdapterInput, ModelAdapterOutput } from '../src/ai/governed-model-orchestrator.js';
import { GovernedAutomationEngine } from '../src/operations/governed-automation.js';
import { TelemetryRegistry } from '../src/operations/telemetry.js';
import { PersistentCapabilityTrustStore } from '../src/platform/capability-trust.js';
import { PrivateIdentityStore } from '../src/security/private-identity.js';
import { validateArchitectureIntegrity } from '../src/validation/architecture-integrity.js';
import { registerCredentialIssuerFixture } from './credential-issuer-fixtures.js';

const at = new Date();

test('provider default clock path produces a verified boundary proof', async () => {
  const issuer = generateSigningIdentity('default-clock-issuer'); const root = generateSigningIdentity('default-clock-root'); const provider = generateSigningIdentity('default-clock-provider'); const registry = new KeyRegistry(); registry.register(provider.keyId, provider.publicKey); const issuerFixture = registerCredentialIssuerFixture({ registry, root, issuer, kinds: ['PROVIDER'], tenantIds: ['t'], scopes: ['model.invoke'], now: at });
  const trust = new ProviderTrustRegistry(registry, issuerFixture.trust, () => at); const credential: ProviderCredential = { credentialId: 'c', providerId: 'p', providerKeyId: provider.keyId, allowedModels: ['m'], tenantIds: ['t'], scopes: ['model.invoke'], issuedAt: new Date(at.getTime()-60_000).toISOString(), expiresAt: new Date(at.getTime()+60_000).toISOString(), issuerId: issuer.keyId, issuerGrantDigest: issuerFixture.grantDigest }; trust.register(signEnvelope(credential, issuer));
  const input: ModelAdapterInput = { requestDigest: sha256('r'), tenantId: 't', subjectId: 's', purpose: 'ANALYZE', objective: 'analyze', allowedTools: ['evidence.read'], context: [], budget: { maxContextChars: 10, maxOutputChars: 10, maxClaims: 1, maxGraphNodes: 1, maxToolProposals: 1, maxLatencyMs: 1000 } };
  const output: ModelAdapterOutput = { provider: 'p', model: 'm', output: 'ok', claims: [], workGraph: [], usage: { inputChars: 0, outputChars: 2, latencyMs: 1 }, startedAt: at.toISOString(), finishedAt: new Date(at.getTime()+1).toISOString(), limitations: [] };
  const policy: ProviderEgressPolicy = { allowedContextSources: ['registry'], allowUntrustedContext: false, maxDisclosedChars: 100, secretHandling: 'REJECT_DETECTED_SECRETS' };
  const attestation = signEnvelope({ attestationId: 'a', nonce: 'n', providerId: 'p', providerKeyId: provider.keyId, model: 'm', tenantId: 't', subjectId: 's', requestDigest: input.requestDigest, inputDigest: sha256(input), policyDigest: sha256({ purpose: input.purpose, allowedTools: [...input.allowedTools].sort(), budget: input.budget }), outputDigest: sha256(output), semanticOutputDigest: sha256({ output: output.output, claims: output.claims, workGraph: output.workGraph }), disclosureDigest: providerDisclosureDigest(input, policy), startedAt: output.startedAt, finishedAt: output.finishedAt, issuedAt: new Date(at.getTime()+1).toISOString() }, provider);
  const result = await new SovereignAttestedProviderBoundary(registry, trust, new InMemoryReplayLedger(), { invokeAttested: async () => ({ output, attestation }) }, policy).invoke(input);
  assert.equal(result.providerBoundaryProof?.status, 'VERIFIED_PROVIDER_ATTESTATION');
});

test('automation normalization sorts multi-entry conditions and payloads deterministically', () => {
  const signer = generateSigningIdentity('function-automation'); const registry = new KeyRegistry(); registry.register(signer.keyId, signer.publicKey); const engine = new GovernedAutomationEngine(registry, signer);
  const rule = engine.activate({ ruleId: 'r', tenantId: 't', name: 'n', triggerType: 'MANUAL_REVIEW', condition: { attributeEquals: { z: '2', a: '1' } }, actions: [{ kind: 'PREPARE_REVIEW', title: 'review', owner: 'owner', payload: { z: 2, a: 1 } }], maxActions: 1, createdBy: 'owner', reviewerIds: ['reviewer-b','reviewer-a'] }, at);
  assert.deepEqual(Object.keys(rule.condition.attributeEquals ?? {}), ['a','z']); assert.deepEqual(Object.keys(rule.actions[0]?.payload ?? {}), ['a','z']);
});

test('telemetry sorts multiple histogram names and samples', () => {
  const registry = new TelemetryRegistry(); registry.observe('z.duration', 2); registry.observe('a.duration', 3); registry.observe('a.duration', 1); const snapshot = registry.snapshot();
  assert.deepEqual(Object.keys(snapshot.histograms), ['a.duration','z.duration']); assert.equal(snapshot.histograms['a.duration']?.p95, 3);
});

test('capability trust tenant listing sorts multiple capabilities', () => {
  const store = new PersistentCapabilityTrustStore(mkdtempSync(join(tmpdir(), 'function-trust-'))); const identity = (id: string) => ({ tenantId: 't', capabilityId: id, version: '1', publisherId: 'p', originalScopes: ['read'] });
  store.register(identity('z')); store.register(identity('a')); assert.deepEqual(store.list('t').map((row) => row.capabilityId), ['a','z']);
});

test('private identity audit listing filters and clones multiple audit records', () => {
  const store = new PrivateIdentityStore(join(mkdtempSync(join(tmpdir(), 'function-identity-')), 'identity.json'));
  store.bootstrap({ tenant: { tenantId: 't', displayName: 'Tenant', status: 'ACTIVE', createdAt: at.toISOString() }, users: [{ userId: 'u', displayName: 'User', status: 'ACTIVE', createdAt: at.toISOString() }], memberships: [{ tenantId: 't', userId: 'u', roles: ['operator'], status: 'ACTIVE' }] }, at);
  const session = store.issueSession({ userId: 'u', tenantId: 't', signingSecret: '01234567890123456789012345678901', ttlMs: 60_000 }, at); store.revokeSession(session.principal.sessionId, 'admin', new Date(at.getTime()+1));
  const records = store.listAudit('t'); assert.ok(records.length >= 2); assert.ok(records.every((record) => record.tenantId === 't' || record.tenantId === undefined));
});

test('architecture cycle canonicalization sorts multiple independent cycles', () => {
  const report = validateArchitectureIntegrity({ nodes: [
    { nodeId: 'a', kind: 'SOURCE', layer: 'x', imports: ['b'] }, { nodeId: 'b', kind: 'SOURCE', layer: 'x', imports: ['a'] },
    { nodeId: 'c', kind: 'SOURCE', layer: 'x', imports: ['d'] }, { nodeId: 'd', kind: 'SOURCE', layer: 'x', imports: ['c'] },
    { nodeId: 'test', kind: 'TEST', layer: 'test', imports: ['a','c'] },
  ], allowedLayerDependencies: { x: ['x'], test: ['x'] }, capabilityPaths: [] });
  assert.equal(report.sourceCycles.length, 2); assert.equal(report.status, 'BLOCK');
});
