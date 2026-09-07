import { sha256, type KeyRegistry, type SignedEnvelope, type SigningIdentity, signEnvelope } from '../contracts/crypto.js';

export interface TestExecutionClaim {
  readonly executionId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly command: readonly string[];
  readonly runnerId: string;
  readonly inputArtifactDigest: string;
  readonly outputArtifactDigest: string;
  readonly capturedOutputDigest: string;
  readonly environmentDigest: string;
  readonly testManifestDigest: string;
  readonly testFilesDigest: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly exitStatus: number;
}

export type SignedTestExecutionClaim = SignedEnvelope<TestExecutionClaim>;

export interface ExpectedTestExecution {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly command: readonly string[];
  readonly authorizedRunnerIds: readonly string[];
  readonly inputArtifactDigest: string;
  readonly outputArtifactDigest: string;
  readonly environmentDigest: string;
  readonly testManifestDigest: string;
  readonly testFilesDigest: string;
  readonly maximumAgeMs: number;
}

export type TestExecutionFailureCode =
  | 'ATTESTATION_SIGNATURE_INVALID'
  | 'RUNNER_UNAUTHORIZED'
  | 'TENANT_OR_SUBJECT_MISMATCH'
  | 'COMMAND_MISMATCH'
  | 'INPUT_ARTIFACT_MISMATCH'
  | 'OUTPUT_ARTIFACT_MISMATCH'
  | 'ENVIRONMENT_MISMATCH'
  | 'TEST_MANIFEST_MISMATCH'
  | 'TEST_FILES_MISMATCH'
  | 'CAPTURED_OUTPUT_INVALID'
  | 'EXECUTION_TIME_INVALID'
  | 'EXECUTION_STALE'
  | 'EXECUTION_FAILED';

export interface TestExecutionVerification {
  readonly ok: boolean;
  readonly failures: readonly TestExecutionFailureCode[];
  readonly attestationDigest: string;
}

export function attestTestExecution(claim: TestExecutionClaim, identity: SigningIdentity): SignedTestExecutionClaim {
  validateClaimShape(claim);
  if (claim.runnerId !== identity.keyId) throw new Error('runner_identity_mismatch');
  return signEnvelope(claim, identity);
}

export function verifyTestExecution(
  attestation: SignedTestExecutionClaim,
  keyRegistry: KeyRegistry,
  expected: ExpectedTestExecution,
  now = new Date(),
): TestExecutionVerification {
  const failures: TestExecutionFailureCode[] = [];
  const claim = attestation.payload;
  try { validateClaimShape(claim); }
  catch { failures.push('EXECUTION_TIME_INVALID'); }

  if (!keyRegistry.verify(attestation)) failures.push('ATTESTATION_SIGNATURE_INVALID');
  if (attestation.issuerKeyId !== claim.runnerId || !expected.authorizedRunnerIds.includes(claim.runnerId)) failures.push('RUNNER_UNAUTHORIZED');
  if (claim.tenantId !== expected.tenantId || claim.subjectId !== expected.subjectId) failures.push('TENANT_OR_SUBJECT_MISMATCH');
  if (JSON.stringify(claim.command) !== JSON.stringify(expected.command)) failures.push('COMMAND_MISMATCH');
  if (claim.inputArtifactDigest !== expected.inputArtifactDigest) failures.push('INPUT_ARTIFACT_MISMATCH');
  if (claim.outputArtifactDigest !== expected.outputArtifactDigest) failures.push('OUTPUT_ARTIFACT_MISMATCH');
  if (claim.environmentDigest !== expected.environmentDigest) failures.push('ENVIRONMENT_MISMATCH');
  if (claim.testManifestDigest !== expected.testManifestDigest) failures.push('TEST_MANIFEST_MISMATCH');
  if (claim.testFilesDigest !== expected.testFilesDigest) failures.push('TEST_FILES_MISMATCH');
  if (!isDigest(claim.capturedOutputDigest)) failures.push('CAPTURED_OUTPUT_INVALID');
  if (claim.exitStatus !== 0) failures.push('EXECUTION_FAILED');

  const started = Date.parse(claim.startedAt);
  const finished = Date.parse(claim.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started || finished > now.getTime() + 5_000) {
    if (!failures.includes('EXECUTION_TIME_INVALID')) failures.push('EXECUTION_TIME_INVALID');
  } else if (now.getTime() - finished > expected.maximumAgeMs) {
    failures.push('EXECUTION_STALE');
  }

  return { ok: failures.length === 0, failures, attestationDigest: sha256(attestation) };
}

function validateClaimShape(claim: TestExecutionClaim): void {
  if (claim.executionId.trim() === '' || claim.tenantId.trim() === '' || claim.subjectId.trim() === '' || claim.runnerId.trim() === '') throw new Error('test_execution_identity_required');
  if (claim.command.length === 0 || claim.command.some((part) => part.trim() === '')) throw new Error('test_execution_command_required');
  for (const digest of [claim.inputArtifactDigest, claim.outputArtifactDigest, claim.capturedOutputDigest, claim.environmentDigest, claim.testManifestDigest, claim.testFilesDigest]) {
    if (!isDigest(digest)) throw new Error('invalid_test_execution_digest');
  }
  const started = Date.parse(claim.startedAt);
  const finished = Date.parse(claim.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) throw new Error('invalid_test_execution_time');
  if (!Number.isInteger(claim.exitStatus) || claim.exitStatus < 0 || claim.exitStatus > 255) throw new Error('invalid_test_execution_status');
}

function isDigest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
