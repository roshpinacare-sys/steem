import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSigningIdentity, KeyRegistry, sha256 } from '../src/contracts/crypto.js';
import { attestTestExecution, verifyTestExecution, type ExpectedTestExecution, type TestExecutionClaim } from '../src/platform/test-execution-provenance.js';

const now = new Date('2026-07-17T15:00:00.000Z');
function setup() {
  const runner = generateSigningIdentity('runner-approved');
  const registry = new KeyRegistry(); registry.register(runner.keyId, runner.publicKey);
  const expected: ExpectedTestExecution = {
    tenantId: 'tenant-1', subjectId: 'candidate-1', command: ['node', '--test', 'dist/tests'], authorizedRunnerIds: [runner.keyId],
    inputArtifactDigest: sha256('input'), outputArtifactDigest: sha256('report'), environmentDigest: sha256({ node: '22.16.0' }),
    testManifestDigest: sha256('manifest'), testFilesDigest: sha256(['a.test.ts']), maximumAgeMs: 60_000,
  };
  const claim: TestExecutionClaim = {
    executionId: 'exec-1', tenantId: expected.tenantId, subjectId: expected.subjectId, command: expected.command, runnerId: runner.keyId,
    inputArtifactDigest: expected.inputArtifactDigest, outputArtifactDigest: expected.outputArtifactDigest, capturedOutputDigest: sha256('tap'),
    environmentDigest: expected.environmentDigest, testManifestDigest: expected.testManifestDigest, testFilesDigest: expected.testFilesDigest,
    startedAt: new Date(now.getTime() - 2_000).toISOString(), finishedAt: new Date(now.getTime() - 1_000).toISOString(), exitStatus: 0,
  };
  return { runner, registry, expected, claim, attestation: attestTestExecution(claim, runner) };
}
function failures(patch: Partial<TestExecutionClaim>, expectedPatch: Partial<ExpectedTestExecution> = {}) {
  const f = setup();
  const claim = { ...f.claim, ...patch };
  const attestation = attestTestExecution(claim, f.runner);
  return verifyTestExecution(attestation, f.registry, { ...f.expected, ...expectedPatch }, now).failures;
}

test('valid execution provenance verifies', () => {
  const f = setup(); assert.equal(verifyTestExecution(f.attestation, f.registry, f.expected, now).ok, true);
});
test('manually modified signed payload is rejected', () => {
  const f = setup(); const forged = { ...f.attestation, payload: { ...f.attestation.payload, exitStatus: 1 } };
  assert.ok(verifyTestExecution(forged, f.registry, f.expected, now).failures.includes('ATTESTATION_SIGNATURE_INVALID'));
});
test('unauthorized runner is rejected even with a valid signature', () => {
  const f = setup(); const attacker = generateSigningIdentity('runner-attacker'); f.registry.register(attacker.keyId, attacker.publicKey);
  const attestation = attestTestExecution({ ...f.claim, runnerId: attacker.keyId }, attacker);
  assert.ok(verifyTestExecution(attestation, f.registry, f.expected, now).failures.includes('RUNNER_UNAUTHORIZED'));
});
test('copied result from another tenant or subject is rejected', () => {
  assert.ok(failures({ tenantId: 'tenant-2' }).includes('TENANT_OR_SUBJECT_MISMATCH'));
  assert.ok(failures({ subjectId: 'candidate-2' }).includes('TENANT_OR_SUBJECT_MISMATCH'));
});
test('command substitution is rejected', () => assert.ok(failures({ command: ['echo', 'pass'] }).includes('COMMAND_MISMATCH')));
test('result copied from another repository version is rejected', () => assert.ok(failures({ inputArtifactDigest: sha256('other-input') }).includes('INPUT_ARTIFACT_MISMATCH')));
test('test output and environment substitution are rejected', () => {
  assert.ok(failures({ outputArtifactDigest: sha256('other-report') }).includes('OUTPUT_ARTIFACT_MISMATCH'));
  assert.ok(failures({ environmentDigest: sha256({ node: 'attacker' }) }).includes('ENVIRONMENT_MISMATCH'));
});
test('deleted or changed tests are rejected', () => {
  assert.ok(failures({ testManifestDigest: sha256('other-manifest') }).includes('TEST_MANIFEST_MISMATCH'));
  assert.ok(failures({ testFilesDigest: sha256(['empty.test.ts']) }).includes('TEST_FILES_MISMATCH'));
});
test('stale and future execution timestamps are rejected', () => {
  assert.ok(failures({ startedAt: new Date(now.getTime() - 120_000).toISOString(), finishedAt: new Date(now.getTime() - 119_000).toISOString() }).includes('EXECUTION_STALE'));
  assert.ok(failures({ startedAt: new Date(now.getTime() + 10_000).toISOString(), finishedAt: new Date(now.getTime() + 11_000).toISOString() }).includes('EXECUTION_TIME_INVALID'));
});
test('non-zero exit status is rejected', () => assert.ok(failures({ exitStatus: 1 }).includes('EXECUTION_FAILED')));
test('attester cannot claim a different runner identity', () => {
  const f = setup(); assert.throws(() => attestTestExecution({ ...f.claim, runnerId: 'someone-else' }, f.runner), /runner_identity_mismatch/);
});
