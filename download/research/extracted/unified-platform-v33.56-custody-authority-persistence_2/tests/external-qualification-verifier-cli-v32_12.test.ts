import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../src/contracts/crypto.js';
import {
  REQUIRED_EXTERNAL_GATE_IDS,
  computeExternalQualificationPolicyDigestV32_12,
  type QualificationCollectorStatementV32_12,
  type QualificationReviewerStatementV32_12,
  type QualificationWitnessStatementV32_12,
} from '../src/qualification/external-qualification-integrity-v32_12.js';

const d = (c: string): string => c.repeat(64);
const iso = (base: number, offsetMs: number): string => new Date(base + offsetMs).toISOString();

function buildCliFixture(root: string) {
  const now = Date.now();
  const rootKey = generateSigningIdentity('external-qualification-root-v1');
  const collectorKey = generateSigningIdentity('collector-cli-key');
  const reviewerKey = generateSigningIdentity('reviewer-cli-key');
  const witnessKey = generateSigningIdentity('witness-cli-key');
  const actorRegistry = new KeyRegistry();
  for (const identity of [collectorKey, reviewerKey, witnessKey]) actorRegistry.register(identity.keyId, identity.publicKey);
  const rootRegistry = new KeyRegistry(); rootRegistry.register(rootKey.keyId, rootKey.publicKey);
  const actor = (role: string, keyId: string) => ({
    actorId: `${role}-actor`, keyId, keyFingerprint: actorRegistry.fingerprint(keyId)!, processId: `${role}-process`, hostId: `${role}-host`, organizationId: `${role}-organization`,
    credentialValidFrom: iso(now, -86_400_000), credentialValidUntil: iso(now, 86_400_000),
  });
  const actors = { collector: actor('collector', collectorKey.keyId), reviewer: actor('reviewer', reviewerKey.keyId), witness: actor('witness', witnessKey.keyId) };
  const policyMaterial = {
    schemaVersion: '32.12' as const,
    policyId: 'cli-production-policy',
    expectedRunId: 'v32.12-cli-production-test',
    expectedSourceDigest: d('a'),
    expectedArtifactDigest: d('b'),
    expectedToolchainDigest: d('c'),
    maximumEvidenceAgeMs: 86_400_000,
    maximumClockSkewMs: 5_000,
    minimumExecutionMode: 'independent-organization' as const,
    requireWitness: true,
    requiredGateIds: REQUIRED_EXTERNAL_GATE_IDS,
  };
  const policy = { ...policyMaterial, policyDigest: computeExternalQualificationPolicyDigestV32_12(policyMaterial) };
  const identityFor = (gateId: typeof REQUIRED_EXTERNAL_GATE_IDS[number]) => ({
    schemaVersion: '32.12' as const, runId: policy.expectedRunId, qualificationId: `qualification-${gateId}`, gateId,
    sourceDigest: policy.expectedSourceDigest, artifactDigest: policy.expectedArtifactDigest, toolchainDigest: policy.expectedToolchainDigest,
    environmentFingerprint: d('d'), policyDigest: policy.policyDigest, adapterVersion: '32.12.1',
  });
  let previousWitnessDigest: string | null = null;
  const rawFiles: string[] = [];
  const bundles = REQUIRED_EXTERNAL_GATE_IDS.map((gateId, index) => {
    const rawPath = `external-qualification/${gateId}/raw.json`;
    const actualPath = join(root, 'evidence-root', rawPath);
    mkdirSync(dirname(actualPath), { recursive: true });
    rawFiles.push(actualPath);
    const rawBytes = Buffer.from(JSON.stringify({ gateId, observed: true, responseId: `response-${index}` }));
    writeFileSync(actualPath, rawBytes);
    const modifiedAt = new Date(now - 8 * 60_000 + index * 1_000);
    utimesSync(actualPath, modifiedAt, modifiedAt);
    const rawEvidence = { path: rawPath, sha256: createHash('sha256').update(rawBytes).digest('hex'), bytes: rawBytes.length, externalResponseIds: [`response-${gateId}`] };
    const identity = identityFor(gateId);
    const collector: QualificationCollectorStatementV32_12 = {
      identity, executionMode: 'independent-organization', evidenceClass: 'OBSERVED', synthetic: false, state: 'passed', challengeNonce: `nonce-${String(index).padStart(2, '0')}-${'x'.repeat(40)}`,
      startedAt: iso(now, -10 * 60_000), completedAt: iso(now, -9 * 60_000), collectedAt: iso(now, -7 * 60_000), collector: actors.collector, rawEvidence,
    };
    const reviewer: QualificationReviewerStatementV32_12 = {
      identity, challengeNonce: collector.challengeNonce, collectorStatementDigest: sha256(collector), rawEvidenceDigest: sha256(rawEvidence), reviewedAt: iso(now, -5 * 60_000),
      reviewer: actors.reviewer, verdict: 'PASS', rationale: 'Independent verifier CLI review checked the external raw evidence.',
    };
    const witness: QualificationWitnessStatementV32_12 = {
      identity, challengeNonce: collector.challengeNonce, collectorStatementDigest: sha256(collector), reviewerStatementDigest: sha256(reviewer), witnessedAt: iso(now, -3 * 60_000),
      witness: actors.witness, checkpointSequence: index + 1, previousCheckpointDigest: previousWitnessDigest,
    };
    previousWitnessDigest = sha256(witness);
    return { collector: signEnvelope(collector, collectorKey), reviewer: signEnvelope(reviewer, reviewerKey), witness: signEnvelope(witness, witnessKey) };
  });
  const authorizedKeys = [
    { role: 'collector' as const, actor: actors.collector, identity: collectorKey },
    { role: 'reviewer' as const, actor: actors.reviewer, identity: reviewerKey },
    { role: 'witness' as const, actor: actors.witness, identity: witnessKey },
  ].map(({ role, actor: value, identity }) => ({
    role, actorId: value.actorId, keyId: value.keyId, keyFingerprint: value.keyFingerprint, organizationId: value.organizationId,
    allowedGateIds: REQUIRED_EXTERNAL_GATE_IDS, credentialValidFrom: value.credentialValidFrom, credentialValidUntil: value.credentialValidUntil,
    publicKey: actorRegistry.exportPublicKey(identity.keyId),
  }));
  const trustAnchor = { schemaVersion: '32.12', trustAnchorId: 'cli-trust-anchor', rootKeys: rootRegistry.listPublicKeys(), allowedTrustBundleSignerKeyIds: [rootKey.keyId] };
  const trustPayload = { schemaVersion: '32.12' as const, trustBundleId: 'cli-trust-bundle', purpose: 'production' as const, issuedAt: iso(now, -60_000), expiresAt: iso(now, 86_400_000), policy, authorizedKeys };
  const trustBundle = signEnvelope(trustPayload, rootKey);
  const document = { schemaVersion: '32.12', documentId: 'cli-verification-document', bundles };
  const paths = {
    input: join(root, 'input.json'), anchor: join(root, 'anchor.json'), trust: join(root, 'trust.json'), evidenceRoot: join(root, 'evidence-root'), state: join(root, 'state.json'), output: join(root, 'output.json'),
  };
  writeFileSync(paths.input, `${JSON.stringify(document, null, 2)}\n`);
  writeFileSync(paths.anchor, `${JSON.stringify(trustAnchor, null, 2)}\n`);
  writeFileSync(paths.trust, `${JSON.stringify(trustBundle, null, 2)}\n`);
  return { ...paths, rawFiles };
}

function args(paths: ReturnType<typeof buildCliFixture>): string[] {
  return ['scripts/verify-external-qualification-v32_12.mjs', paths.input, paths.anchor, paths.trust, paths.evidenceRoot, paths.state, paths.output];
}

test('verifier-only CLI requires out-of-band trust, hashes real files and persists replay state', () => {
  const root = mkdtempSync(join(tmpdir(), 'v32-12-verifier-'));
  try {
    const paths = buildCliFixture(root);
    execFileSync('node', args(paths), { cwd: process.cwd(), stdio: 'pipe' });
    const report = JSON.parse(readFileSync(paths.output, 'utf8')) as { status: string; passedGates: number; verifierContext: { replayStateGeneration: number; observationsSource: string } };
    assert.equal(report.status, 'QUALIFIED'); assert.equal(report.passedGates, 6);
    assert.equal(report.verifierContext.replayStateGeneration, 1);
    assert.equal(report.verifierContext.observationsSource, 'verifier-filesystem');
    const state = JSON.parse(readFileSync(paths.state, 'utf8')) as { generation: number; consumedNonces: string[] };
    assert.equal(state.generation, 1); assert.equal(state.consumedNonces.length, 6);
    const replay = spawnSync('node', args(paths), { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(replay.status, 2); assert.match(replay.stdout, /challenge_nonce_replayed|witness_checkpoint_sequence_not_monotonic/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('verifier hashes current filesystem bytes and rejects post-signing evidence substitution', () => {
  const root = mkdtempSync(join(tmpdir(), 'v32-12-verifier-'));
  try {
    const paths = buildCliFixture(root);
    const original = readFileSync(paths.rawFiles[0]!);
    const tampered = Buffer.from(original); tampered[0] = tampered[0] === 123 ? 91 : 123;
    writeFileSync(paths.rawFiles[0]!, tampered);
    const old = new Date(Date.now() - 8 * 60_000); utimesSync(paths.rawFiles[0]!, old, old);
    const result = spawnSync('node', args(paths), { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 2); assert.match(result.stdout, /raw_evidence_digest_or_size_mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('verifier rejects symlink evidence and tampered replay state before evaluation', () => {
  const root = mkdtempSync(join(tmpdir(), 'v32-12-verifier-'));
  try {
    const paths = buildCliFixture(root);
    const target = join(root, 'other.json'); writeFileSync(target, '{"other":true}');
    unlinkSync(paths.rawFiles[0]!); symlinkSync(target, paths.rawFiles[0]!);
    const symlink = spawnSync('node', args(paths), { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(symlink.status, 2); assert.match(symlink.stdout, /raw_evidence_symlink_forbidden/);

    const fresh = buildCliFixture(join(root, 'fresh')); execFileSync('node', args(fresh), { cwd: process.cwd(), stdio: 'pipe' });
    const state = JSON.parse(readFileSync(fresh.state, 'utf8')) as Record<string, unknown>; state.generation = 99;
    writeFileSync(fresh.state, JSON.stringify(state));
    const tamperedState = spawnSync('node', args(fresh), { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(tamperedState.status, 2); assert.match(tamperedState.stdout, /replay_state_invalid/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('self-contained attacker keys, policy, observations and evaluation time are rejected as unexpected fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'v32-12-verifier-'));
  try {
    const paths = buildCliFixture(root);
    writeFileSync(paths.input, JSON.stringify({ schemaVersion: '32.12', documentId: 'forged', bundles: [], publicKeys: [], policy: {}, evaluatedAt: new Date().toISOString(), observations: [] }));
    const result = spawnSync('node', args(paths), { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 2); assert.match(result.stdout, /verification_document_unexpected_fields/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});



test('verifier rejects signed but uninterpreted nested fields in evidence and trust payloads', () => {
  const root = mkdtempSync(join(tmpdir(), 'v32-12-verifier-'));
  try {
    const paths = buildCliFixture(root);
    const document = JSON.parse(readFileSync(paths.input, 'utf8')) as any;
    document.bundles[0].collector.payload.uninterpretedPrivilege = 'production';
    writeFileSync(paths.input, JSON.stringify(document));
    const evidenceExtra = spawnSync('node', args(paths), { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(evidenceExtra.status, 2);
    assert.match(evidenceExtra.stdout, /collector\.payload_unexpected_fields/);

    const fresh = buildCliFixture(join(root, 'fresh'));
    const trust = JSON.parse(readFileSync(fresh.trust, 'utf8')) as any;
    trust.payload.policy.uninterpretedOverride = true;
    writeFileSync(fresh.trust, JSON.stringify(trust));
    const trustExtra = spawnSync('node', args(fresh), { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(trustExtra.status, 2);
    assert.match(trustExtra.stdout, /trust_bundle\.payload\.policy_unexpected_fields/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('verifier preserves a lock it does not own and blocks concurrent state mutation', () => {
  const root = mkdtempSync(join(tmpdir(), 'v32-12-verifier-'));
  try {
    const paths = buildCliFixture(root);
    const lock = `${paths.state}.lock`;
    writeFileSync(lock, 'owned-by-another-verifier\n', { mode: 0o600 });
    const result = spawnSync('node', args(paths), { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /EEXIST|verifier_error/);
    assert.equal(readFileSync(lock, 'utf8'), 'owned-by-another-verifier\n');
    assert.equal(readFileSync(paths.output, 'utf8').includes('BLOCKED'), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('verifier-only CLI rejects duplicate JSON keys before evidence evaluation', () => {
  const root = mkdtempSync(join(tmpdir(), 'v32-12-verifier-'));
  try {
    const paths = buildCliFixture(root);
    writeFileSync(paths.input, '{"schemaVersion":"32.12","documentId":"a","documentId":"b","bundles":[]}');
    const result = spawnSync('node', args(paths), { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 2); assert.match(result.stdout, /strict_json_duplicate_key/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('verifier-only CLI rejects incomplete invocation before reading any trust material', () => {
  const result = spawnSync('node', ['scripts/verify-external-qualification-v32_12.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /usage: verify-external-qualification-v32_12\.mjs/);
});
