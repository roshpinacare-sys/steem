import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../src/contracts/crypto.js';
import { evidenceDigest, type ActionPassport, type AuthorityGrant, type EvidenceRecord } from '../src/contracts/canonical.js';
import { DigitalThread, type ThreadNodeKind } from '../src/platform/digital-thread.js';
import { EvidenceCompletenessGate, type EvidenceCompletenessInput } from '../src/platform/evidence-completeness.js';
import { FileReplayLedger } from '../src/platform/replay-ledger.js';
import { attestTestExecution } from '../src/platform/test-execution-provenance.js';

const now = new Date('2026-07-17T10:00:00.000Z');

function fixture(): EvidenceCompletenessInput {
  const issuer = generateSigningIdentity('authority-key');
  const passportSigner = generateSigningIdentity('passport-key');
  const testRunner = generateSigningIdentity('authorized-test-runner');
  const registry = new KeyRegistry();
  registry.register(issuer.keyId, issuer.publicKey);
  registry.register(passportSigner.keyId, passportSigner.publicKey);
  registry.register(testRunner.keyId, testRunner.publicKey);
  const grant: AuthorityGrant = {
    grantId: 'grant-gate-1', tenantId: 'tenant-1', subjectId: 'candidate-1', scopes: ['release.shadow'],
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), issuer: 'kernel',
  };
  const expectedTestExecution = {
    tenantId: 'tenant-1', subjectId: 'candidate-1', command: ['node', '--test', 'dist/tests'], authorizedRunnerIds: [testRunner.keyId],
    inputArtifactDigest: sha256('candidate-input'), outputArtifactDigest: sha256('report'), environmentDigest: sha256({ node: 'v22.16.0', os: 'linux' }),
    testManifestDigest: sha256('manifest'), testFilesDigest: sha256(['tests/evidence-completeness.test.ts']), maximumAgeMs: 300_000,
  } as const;
  const testExecutionAttestation = attestTestExecution({
    executionId: 'execution-1', tenantId: 'tenant-1', subjectId: 'candidate-1', command: expectedTestExecution.command, runnerId: testRunner.keyId,
    inputArtifactDigest: expectedTestExecution.inputArtifactDigest, outputArtifactDigest: expectedTestExecution.outputArtifactDigest,
    capturedOutputDigest: sha256('tap-output'), environmentDigest: expectedTestExecution.environmentDigest,
    testManifestDigest: expectedTestExecution.testManifestDigest, testFilesDigest: expectedTestExecution.testFilesDigest,
    startedAt: new Date(now.getTime() - 1_000).toISOString(), finishedAt: new Date(now.getTime() - 500).toISOString(), exitStatus: 0,
  }, testRunner);
  const records = chain([
    record('tests-1', 'test-report', 'ATTESTED', { executed: true, passed: true, failCount: 0, reportDigest: sha256('report'), testManifestDigest: sha256('manifest'), attestationDigest: sha256(testExecutionAttestation) }),
    record('artifact-1', 'artifact-manifest', 'COMPUTED', { artifactDigest: sha256('artifact') }),
    record('claims-1', 'unsupported-claims', 'OBSERVED', { claims: [] }),
    record('rollback-1', 'rollback-verification', 'OBSERVED', { passed: true }),
  ]);
  const evidenceRoot = evidenceDigest(records.at(-1)!);
  const thread = createThread('tenant-1', 'candidate-1', evidenceRoot, ['AUTHORITY_GRANT', 'COMMITMENT', 'REQUIREMENT', 'MISSION', 'ARTIFACT', 'EVIDENCE', 'CERTIFICATION', 'PASSPORT']);
  const passportPayload: ActionPassport = {
    passportId: 'passport-1', tenantId: 'tenant-1', subject: 'candidate-1', authorityGrantDigest: sha256(grant),
    evidenceRoot, promotionState: 'shadow', issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    reviewerIds: ['reviewer-1'], limitations: ['shadow-only'],
  };
  return {
    tenantId: 'tenant-1', subjectId: 'candidate-1', builderId: 'builder-1', reviewerIds: ['reviewer-1'],
    requiredScope: 'release.shadow', authority: signEnvelope(grant, issuer), keyRegistry: registry,
    evidenceRecords: records, evidenceRoot,
    requiredEvidenceKinds: ['test-report', 'artifact-manifest', 'unsupported-claims', 'rollback-verification'],
    requiredEvidenceClasses: ['ATTESTED', 'COMPUTED', 'OBSERVED'],
    expectedTestReportDigest: sha256('report'), expectedTestManifestDigest: sha256('manifest'), expectedArtifactDigest: sha256('artifact'),
    testExecutionAttestation, expectedTestExecution,
    rollback: { ref: 'rollback:1', verified: true }, digitalThread: thread,
    requiredThreadKinds: ['AUTHORITY_GRANT', 'COMMITMENT', 'REQUIREMENT', 'MISSION', 'ARTIFACT', 'EVIDENCE', 'CERTIFICATION', 'PASSPORT'],
    passport: signEnvelope(passportPayload, passportSigner),
  };
}

function record(recordId: string, kind: string, evidenceClass: EvidenceRecord['evidenceClass'], payload: Record<string, unknown>): EvidenceRecord {
  return { recordId, tenantId: 'tenant-1', kind, subject: 'candidate-1', payload, evidenceClass, method: 'test.v21', environment: { runtime: 'node' }, createdAt: now.toISOString(), limitations: [] };
}
function chain(records: readonly EvidenceRecord[]): EvidenceRecord[] {
  let previous: string | undefined;
  return records.map((item) => {
    const current = previous === undefined ? item : { ...item, previousDigest: previous };
    previous = evidenceDigest(current);
    return current;
  });
}
function createThread(tenantId: string, subject: string, evidenceRoot: string, kinds: readonly ThreadNodeKind[]): DigitalThread {
  const thread = new DigitalThread();
  for (const [index, kind] of kinds.entries()) {
    thread.addNode({ nodeId: `node-${index}-${kind}`, tenantId, kind, subject, payloadDigest: kind === 'EVIDENCE' ? evidenceRoot : sha256({ kind, subject }), createdAt: now.toISOString() });
    if (index > 0) thread.addEdge({ edgeId: `edge-${index}`, tenantId, fromNodeId: `node-${index - 1}-${kinds[index - 1]}`, toNodeId: `node-${index}-${kind}`, relation: 'SUPPORTS', createdAt: now.toISOString() });
  }
  return thread;
}
function codes(decision: ReturnType<EvidenceCompletenessGate['evaluate']>): string[] { return decision.failures.map((failure) => failure.code); }
function withoutPrevious(item: EvidenceRecord): EvidenceRecord { const { previousDigest: _ignored, ...rest } = item; return rest; }

test('complete evidence, independent review, rollback, thread and passport pass', () => {
  const decision = new EvidenceCompletenessGate().evaluate(fixture(), now);
  assert.equal(decision.status, 'PASS');
  assert.equal(decision.failures.length, 0);
});

test('missing or fake test evidence and deleted test manifest fail closed', () => {
  const input = fixture();
  const records = chain(input.evidenceRecords.map((item) => item.kind === 'test-report'
    ? { ...withoutPrevious(item), payload: { ...item.payload, passed: false, failCount: 1, testManifestDigest: sha256('deleted-tests') } }
    : withoutPrevious(item)));
  const decision = new EvidenceCompletenessGate().evaluate({ ...input, evidenceRecords: records, evidenceRoot: evidenceDigest(records.at(-1)!), consumeReplayKey: false }, now);
  assert.ok(codes(decision).includes('TEST_EVIDENCE_INVALID'));
  assert.ok(codes(decision).includes('TEST_MANIFEST_MISMATCH'));
});

test('wrong artifact digest and missing unsupported-claims register fail', () => {
  const input = fixture();
  const records = chain(input.evidenceRecords.filter((item) => item.kind !== 'unsupported-claims').map((item) => item.kind === 'artifact-manifest'
    ? { ...withoutPrevious(item), payload: { artifactDigest: sha256('other') } }
    : withoutPrevious(item)));
  const decision = new EvidenceCompletenessGate().evaluate({ ...input, evidenceRecords: records, evidenceRoot: evidenceDigest(records.at(-1)!), consumeReplayKey: false }, now);
  assert.ok(codes(decision).includes('ARTIFACT_DIGEST_MISMATCH'));
  assert.ok(codes(decision).includes('UNSUPPORTED_CLAIMS_MISSING'));
});

test('self approval and missing verified rollback fail', () => {
  const input = fixture();
  const { passport: _passport, ...withoutPassport } = input;
  const decision = new EvidenceCompletenessGate().evaluate({ ...withoutPassport, reviewerIds: ['builder-1'], rollback: { ref: '', verified: false }, consumeReplayKey: false }, now);
  assert.ok(codes(decision).includes('SELF_APPROVAL'));
  assert.ok(codes(decision).includes('ROLLBACK_MISSING'));
});

test('expired authority and revoked signer fail', () => {
  const input = fixture();
  input.keyRegistry.revoke(input.authority.issuerKeyId);
  const decision = new EvidenceCompletenessGate().evaluate({ ...input, consumeReplayKey: false }, new Date(now.getTime() + 120_000));
  assert.ok(codes(decision).includes('AUTHORITY_INVALID'));
  assert.ok(codes(decision).includes('AUTHORITY_DENIED'));
});

test('Evidence Completeness Gate rejects simulated evidence for a physical claim', () => {
  const input = fixture();
  const invalid = { ...record('sim-1', 'physical-claim', 'SIMULATED', { physicalClaimAllowed: true }), previousDigest: input.evidenceRoot };
  const records = [...input.evidenceRecords, invalid];
  const decision = new EvidenceCompletenessGate().evaluate({ ...input, evidenceRecords: records, consumeReplayKey: false }, now);
  assert.ok(codes(decision).includes('EVIDENCE_INVALID'));
});

test('incomplete or tampered Digital Thread blocks promotion', () => {
  const input = fixture();
  const thread = createThread('tenant-1', 'candidate-1', input.evidenceRoot, ['AUTHORITY_GRANT', 'COMMITMENT', 'EVIDENCE']);
  const incomplete = new EvidenceCompletenessGate().evaluate({ ...input, digitalThread: thread, consumeReplayKey: false }, now);
  assert.ok(codes(incomplete).includes('DIGITAL_THREAD_INCOMPLETE'));
  process.env.NODE_ENV = 'test';
  thread.unsafeTamperNodeForTest('node-1-COMMITMENT', 'tampered');
  const tampered = new EvidenceCompletenessGate().evaluate({ ...input, digitalThread: thread, consumeReplayKey: false }, now);
  assert.ok(codes(tampered).includes('DIGITAL_THREAD_INVALID'));
});

test('conflicting or invalid passport blocks the gate', () => {
  const input = fixture();
  const conflict = signEnvelope({ ...input.passport!.payload, evidenceRoot: sha256('other') }, generateSigningIdentity('unknown-key'));
  const decision = new EvidenceCompletenessGate().evaluate({ ...input, passport: conflict, consumeReplayKey: false }, now);
  assert.ok(codes(decision).includes('PASSPORT_INVALID'));
  assert.ok(codes(decision).includes('PASSPORT_CONFLICT'));
});

test('evidence root can be consumed only once after a successful decision', () => {
  const gate = new EvidenceCompletenessGate();
  const input = fixture();
  assert.equal(gate.evaluate(input, now).status, 'PASS');
  const second = gate.evaluate(input, now);
  assert.ok(codes(second).includes('EVIDENCE_REPLAY'));
});

test('failed decision does not consume replay key and can be corrected', () => {
  const gate = new EvidenceCompletenessGate();
  const input = fixture();
  assert.equal(gate.evaluate({ ...input, rollback: { ref: '', verified: false } }, now).status, 'BLOCK');
  assert.equal(gate.evaluate(input, now).status, 'PASS');
});


test('persistent replay ledger blocks the same evidence after gate restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-replay-v25-'));
  const input = fixture();
  const first = new EvidenceCompletenessGate(new FileReplayLedger(root));
  assert.equal(first.evaluate(input, now).status, 'PASS');
  const restarted = new EvidenceCompletenessGate(new FileReplayLedger(root));
  assert.ok(codes(restarted.evaluate(input, now)).includes('EVIDENCE_REPLAY'));
});
