import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyRegistry, generateSigningIdentity, signEnvelope } from '../src/contracts/crypto.js';
import { REQUIRED_EXTERNAL_GATE_IDS, computeExternalQualificationPolicyDigestV32_12 } from '../src/qualification/external-qualification-integrity-v32_12.js';
import { verifyExternalQualificationTrustBundleV32_12, type AuthorizedQualificationKeyV32_12 } from '../src/qualification/external-qualification-trust-v32_12.js';

const d = (c: string): string => c.repeat(64);
const at = '2026-07-19T12:00:00.000Z';

function fixture() {
  const root = generateSigningIdentity('root-key');
  const collector = generateSigningIdentity('collector-key');
  const reviewer = generateSigningIdentity('reviewer-key');
  const witness = generateSigningIdentity('witness-key');
  const roots = new KeyRegistry(); roots.register(root.keyId, root.publicKey);
  const actors = new KeyRegistry(); for (const key of [collector, reviewer, witness]) actors.register(key.keyId, key.publicKey);
  const policyMaterial = {
    schemaVersion: '32.12' as const, policyId: 'production-policy', expectedRunId: 'external-run-001', expectedSourceDigest: d('a'), expectedArtifactDigest: d('b'), expectedToolchainDigest: d('c'),
    maximumEvidenceAgeMs: 86_400_000, maximumClockSkewMs: 5_000, minimumExecutionMode: 'independent-organization' as const, requireWitness: true, requiredGateIds: REQUIRED_EXTERNAL_GATE_IDS,
  };
  const policy = { ...policyMaterial, policyDigest: computeExternalQualificationPolicyDigestV32_12(policyMaterial) };
  const authorization = (role: 'collector'|'reviewer'|'witness', key: typeof collector) => ({
    role, actorId: `${role}-actor`, keyId: key.keyId, keyFingerprint: actors.fingerprint(key.keyId)!, organizationId: `${role}-org`, allowedGateIds: REQUIRED_EXTERNAL_GATE_IDS,
    credentialValidFrom: '2026-07-01T00:00:00.000Z', credentialValidUntil: '2026-08-01T00:00:00.000Z', publicKey: actors.exportPublicKey(key.keyId),
  });
  const payload = { schemaVersion: '32.12' as const, trustBundleId: 'production-trust-bundle', purpose: 'production' as const, issuedAt: '2026-07-19T11:00:00.000Z', expiresAt: '2026-07-20T11:00:00.000Z', policy, authorizedKeys: [authorization('collector',collector),authorization('reviewer',reviewer),authorization('witness',witness)] };
  const anchor = { schemaVersion: '32.12' as const, trustAnchorId: 'root-anchor', rootKeys: roots.listPublicKeys(), allowedTrustBundleSignerKeyIds: [root.keyId] };
  return { root, collector, reviewer, witness, anchor, payload, bundle: signEnvelope(payload, root) };
}

test('signed out-of-band trust bundle authorizes actor keys and binds the production policy digest', () => {
  const f = fixture();
  const verified = verifyExternalQualificationTrustBundleV32_12(f.anchor, f.bundle, at);
  assert.equal(verified.purpose, 'production');
  assert.equal(verified.authorizations.length, 3);
  assert.equal(verified.policy.requiredGateIds.length, 6);
  assert.equal(verified.keyRegistry.fingerprint(f.collector.keyId), f.payload.authorizedKeys[0]!.keyFingerprint);
});

test('self-signed attacker trust bundle cannot replace the out-of-band trust root', () => {
  const f = fixture();
  const attacker = generateSigningIdentity('attacker-root');
  const forged = signEnvelope(f.payload, attacker);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, forged, at), /trust_bundle_signer_not_allowed|trust_bundle_signature_invalid/);
});


test('an allowed trust-bundle signer still requires a valid cryptographic signature', () => {
  const f = fixture();
  const tampered = { ...f.bundle, signature: `${f.bundle.signature[0] === 'A' ? 'B' : 'A'}${f.bundle.signature.slice(1)}` };
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, tampered, at), /trust_bundle_signature_invalid/);
});

test('expired, tampered and non-independent production trust bundles fail closed', () => {
  const f = fixture();
  const expired = signEnvelope({ ...f.payload, expiresAt: '2026-07-19T11:30:00.000Z' }, f.root);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, expired, at), /trust_bundle_expired/);
  const tamperedPolicy = { ...f.payload.policy, expectedRunId: 'changed-run' };
  const tampered = signEnvelope({ ...f.payload, policy: tamperedPolicy }, f.root);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, tampered, at), /policy_digest_mismatch/);
  const sameOrg = f.payload.authorizedKeys.map((entry) => ({ ...entry, organizationId: 'single-org' }));
  const collapsed = signEnvelope({ ...f.payload, authorizedKeys: sameOrg }, f.root);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, collapsed, at), /organization_independence_missing/);
});

test('root signing key cannot also be authorized as collector, reviewer or witness', () => {
  const f = fixture();
  const rootRecord = f.anchor.rootKeys[0]!;
  const authorizedKeys = f.payload.authorizedKeys.map((entry, index) => index === 0 ? { ...entry, keyId: rootRecord.keyId, keyFingerprint: rootRecord.fingerprint, publicKey: rootRecord } : entry);
  const bundle = signEnvelope({ ...f.payload, authorizedKeys }, f.root);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, bundle, at), /root_key_cannot_be_actor/);
});

test('trust anchor, bundle identity and validity interval branches fail closed', () => {
  const f = fixture();
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, f.bundle, '2026-07-19T12:00:00Z'), /trust_evaluated_at_invalid/);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12({ ...f.anchor, schemaVersion: '32.11' as '32.12' }, f.bundle, at), /trust_anchor_invalid/);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12({ ...f.anchor, trustAnchorId: '' }, f.bundle, at), /trust_anchor_invalid/);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12({ ...f.anchor, rootKeys: [] }, f.bundle, at), /trust_anchor_invalid/);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12({ ...f.anchor, allowedTrustBundleSignerKeyIds: [] }, f.bundle, at), /trust_anchor_signer_set_invalid/);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12({ ...f.anchor, allowedTrustBundleSignerKeyIds: [f.root.keyId, f.root.keyId] }, f.bundle, at), /trust_anchor_signer_set_invalid/);

  const invalidIdentity = signEnvelope({ ...f.payload, schemaVersion: '32.11' as '32.12' }, f.root);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, invalidIdentity, at), /trust_bundle_identity_invalid/);
  const blankId = signEnvelope({ ...f.payload, trustBundleId: '' }, f.root);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, blankId, at), /trust_bundle_identity_invalid/);
  const reversed = signEnvelope({ ...f.payload, issuedAt: '2026-07-20T12:00:00.000Z', expiresAt: '2026-07-19T12:00:00.000Z' }, f.root);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, reversed, at), /trust_bundle_interval_invalid/);
  const future = signEnvelope({ ...f.payload, issuedAt: '2026-07-19T13:00:00.000Z', expiresAt: '2026-07-20T13:00:00.000Z' }, f.root);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, future, at), /trust_bundle_not_yet_valid/);
});

test('trust-bundle actor authorization structure covers duplicate, identity, scope and interval failures', () => {
  const f = fixture();
  const sign = (authorizedKeys: readonly AuthorizedQualificationKeyV32_12[]) => signEnvelope({ ...f.payload, authorizedKeys }, f.root);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, sign([...f.payload.authorizedKeys, f.payload.authorizedKeys[0]!]), at), /authorization_duplicate/);
  const mismatchedPublicKey = f.payload.authorizedKeys.map((entry, index) => index === 0 ? { ...entry, publicKey: f.payload.authorizedKeys[1]!.publicKey } : entry);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, sign(mismatchedPublicKey), at), /authorized_key_identity_mismatch/);
  const invalidActor = f.payload.authorizedKeys.map((entry, index) => index === 0 ? { ...entry, actorId: 'bad actor id' } : entry);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, sign(invalidActor), at), /authorization_invalid/);
  const noScope = f.payload.authorizedKeys.map((entry, index) => index === 0 ? { ...entry, allowedGateIds: [] } : entry);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, sign(noScope), at), /authorization_invalid/);
  const reversed = f.payload.authorizedKeys.map((entry, index) => index === 0 ? { ...entry, credentialValidFrom: '2026-08-02T00:00:00.000Z', credentialValidUntil: '2026-08-01T00:00:00.000Z' } : entry);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, sign(reversed), at), /authorization_interval_invalid/);
  assert.throws(() => verifyExternalQualificationTrustBundleV32_12(f.anchor, sign(f.payload.authorizedKeys.filter((entry) => entry.role !== 'witness')), at), /missing_witness_authorization/);
});

test('diagnostic trust may share organizations but remains bound to a signed scoped policy', () => {
  const f = fixture();
  const gateId = REQUIRED_EXTERNAL_GATE_IDS[0];
  const basePolicy = { ...f.payload.policy, minimumExecutionMode: 'independent-process' as const, requireWitness: false, requiredGateIds: [gateId] };
  const { policyDigest: _ignored, ...unsignedPolicy } = basePolicy;
  const policy = { ...unsignedPolicy, policyDigest: computeExternalQualificationPolicyDigestV32_12(unsignedPolicy) };
  const authorizedKeys = f.payload.authorizedKeys.map((entry) => ({ ...entry, organizationId: 'diagnostic-organization', allowedGateIds: [gateId] }));
  const payload = { ...f.payload, purpose: 'diagnostic' as const, policy, authorizedKeys };
  const verified = verifyExternalQualificationTrustBundleV32_12(f.anchor, signEnvelope(payload, f.root), at);
  assert.equal(verified.purpose, 'diagnostic');
  assert.equal(verified.policy.requiredGateIds.length, 1);
});
