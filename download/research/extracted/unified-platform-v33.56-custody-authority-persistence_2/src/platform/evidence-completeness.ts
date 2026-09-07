import {
  authorityAllows,
  evidenceDigest,
  validateActionPassport,
  validateEvidenceRecord,
  type ActionPassport,
  type EvidenceClass,
  type EvidenceRecord,
  type SignedAuthorityGrant,
} from '../contracts/canonical.js';
import { KeyRegistry, sha256, type SignedEnvelope } from '../contracts/crypto.js';
import { DigitalThread, type ThreadNodeKind } from './digital-thread.js';
import { verifyTestExecution, type ExpectedTestExecution, type SignedTestExecutionClaim } from './test-execution-provenance.js';
import { InMemoryReplayLedger, type ReplayLedger } from './replay-ledger.js';

export type EvidenceGateFailureCode =
  | 'AUTHORITY_INVALID'
  | 'AUTHORITY_DENIED'
  | 'TENANT_MISMATCH'
  | 'DUPLICATE_EVIDENCE'
  | 'EVIDENCE_INVALID'
  | 'EVIDENCE_CHAIN_INVALID'
  | 'EVIDENCE_ROOT_MISMATCH'
  | 'REQUIRED_EVIDENCE_MISSING'
  | 'TEST_EVIDENCE_INVALID'
  | 'TEST_MANIFEST_MISMATCH'
  | 'TEST_EXECUTION_ATTESTATION_MISSING'
  | 'TEST_EXECUTION_ATTESTATION_INVALID'
  | 'TEST_RUNNER_UNAUTHORIZED'
  | 'TEST_COMMAND_MISMATCH'
  | 'TEST_INPUT_ARTIFACT_MISMATCH'
  | 'TEST_OUTPUT_ARTIFACT_MISMATCH'
  | 'TEST_ENVIRONMENT_MISMATCH'
  | 'TEST_FILES_MISMATCH'
  | 'TEST_EXECUTION_TIME_INVALID'
  | 'TEST_EXECUTION_STALE'
  | 'ARTIFACT_DIGEST_MISMATCH'
  | 'UNSUPPORTED_CLAIMS_MISSING'
  | 'REVIEWER_MISSING'
  | 'SELF_APPROVAL'
  | 'ROLLBACK_MISSING'
  | 'DIGITAL_THREAD_INVALID'
  | 'DIGITAL_THREAD_INCOMPLETE'
  | 'PASSPORT_INVALID'
  | 'PASSPORT_CONFLICT'
  | 'EVIDENCE_REPLAY';

export interface EvidenceGateFailure {
  readonly code: EvidenceGateFailureCode;
  readonly message: string;
  readonly evidenceRecordId?: string;
}

export interface EvidenceCompletenessInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly builderId: string;
  readonly reviewerIds: readonly string[];
  readonly requiredScope: string;
  readonly authority: SignedAuthorityGrant;
  readonly keyRegistry: KeyRegistry;
  readonly evidenceRecords: readonly EvidenceRecord[];
  readonly evidenceRoot: string;
  readonly requiredEvidenceKinds: readonly string[];
  readonly requiredEvidenceClasses?: readonly EvidenceClass[];
  readonly expectedTestReportDigest: string;
  readonly expectedTestManifestDigest: string;
  readonly expectedArtifactDigest: string;
  readonly testExecutionAttestation: SignedTestExecutionClaim;
  readonly expectedTestExecution: ExpectedTestExecution;
  readonly rollback: { readonly ref: string; readonly verified: boolean };
  readonly digitalThread: DigitalThread;
  readonly requiredThreadKinds: readonly ThreadNodeKind[];
  readonly passport?: SignedEnvelope<ActionPassport>;
  readonly consumeReplayKey?: boolean;
}

export interface EvidenceCompletenessDecision {
  readonly status: 'PASS' | 'BLOCK';
  readonly tenantId: string;
  readonly subjectId: string;
  readonly evidenceRoot: string;
  readonly failures: readonly EvidenceGateFailure[];
  readonly summary: {
    readonly evidenceCount: number;
    readonly requiredKindCount: number;
    readonly reviewerCount: number;
    readonly threadNodeCount: number;
    readonly threadEdgeCount: number;
  };
  readonly decisionDigest: string;
}

export class EvidenceCompletenessGate {
  readonly #replayLedger: ReplayLedger;

  constructor(replayLedger: ReplayLedger = new InMemoryReplayLedger()) { this.#replayLedger = replayLedger; }

  evaluate(input: EvidenceCompletenessInput, now = new Date()): EvidenceCompletenessDecision {
    const failures: EvidenceGateFailure[] = [];
    const add = (code: EvidenceGateFailureCode, message: string, evidenceRecordId?: string) => {
      failures.push(evidenceRecordId === undefined ? { code, message } : { code, message, evidenceRecordId });
    };

    if (!input.keyRegistry.verify(input.authority)) add('AUTHORITY_INVALID', 'Authority signature is invalid or its key is revoked.');
    if (!authorityAllows(input.authority.payload, {
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      scope: input.requiredScope,
      ...(input.authority.payload.workspaceId === undefined ? {} : { workspaceId: input.authority.payload.workspaceId }),
    }, now)) add('AUTHORITY_DENIED', 'Authority does not permit the requested tenant, subject, scope, workspace, or time window.');

    const ids = new Set<string>();
    let previousDigest: string | undefined;
    for (const record of input.evidenceRecords) {
      if (record.tenantId !== input.tenantId) add('TENANT_MISMATCH', 'Evidence belongs to a different tenant.', record.recordId);
      if (ids.has(record.recordId)) add('DUPLICATE_EVIDENCE', 'Evidence record identifier is duplicated.', record.recordId);
      ids.add(record.recordId);
      try { validateEvidenceRecord(record); }
      catch (error) { add('EVIDENCE_INVALID', error instanceof Error ? error.message : String(error), record.recordId); }
      if (record.previousDigest !== previousDigest) add('EVIDENCE_CHAIN_INVALID', 'Evidence previousDigest does not match the prior record.', record.recordId);
      try { previousDigest = evidenceDigest(record); }
      catch { previousDigest = undefined; }
    }
    if ((previousDigest ?? '') !== input.evidenceRoot) add('EVIDENCE_ROOT_MISMATCH', 'Evidence root is not the final verified evidence digest.');

    for (const kind of input.requiredEvidenceKinds) {
      if (!input.evidenceRecords.some((record) => record.kind === kind)) add('REQUIRED_EVIDENCE_MISSING', `Required evidence kind is missing: ${kind}.`);
    }
    for (const evidenceClass of input.requiredEvidenceClasses ?? []) {
      if (!input.evidenceRecords.some((record) => record.evidenceClass === evidenceClass)) add('REQUIRED_EVIDENCE_MISSING', `Required evidence class is missing: ${evidenceClass}.`);
    }

    const testRecord = input.evidenceRecords.find((record) => record.kind === 'test-report');
    if (testRecord === undefined) {
      add('TEST_EVIDENCE_INVALID', 'Executed test evidence is missing.');
    } else {
      const payload = testRecord.payload;
      if ((testRecord.evidenceClass !== 'ATTESTED' && testRecord.evidenceClass !== 'OBSERVED')
        || payload.executed !== true || payload.passed !== true || payload.failCount !== 0
        || payload.reportDigest !== input.expectedTestReportDigest) {
        add('TEST_EVIDENCE_INVALID', 'Test evidence is not executed, passing, attested/observed, or digest-bound.', testRecord.recordId);
      }
      if (payload.testManifestDigest !== input.expectedTestManifestDigest) {
        add('TEST_MANIFEST_MISMATCH', 'The executed test manifest does not match the approved test set.', testRecord.recordId);
      }
      const verification = verifyTestExecution(input.testExecutionAttestation, input.keyRegistry, input.expectedTestExecution, now);
      if (payload.attestationDigest !== verification.attestationDigest) {
        add('TEST_EXECUTION_ATTESTATION_INVALID', 'The test evidence is not bound to the supplied execution attestation.', testRecord.recordId);
      }
      for (const failure of verification.failures) {
        const mapped = failure === 'RUNNER_UNAUTHORIZED' ? 'TEST_RUNNER_UNAUTHORIZED'
          : failure === 'COMMAND_MISMATCH' ? 'TEST_COMMAND_MISMATCH'
            : failure === 'INPUT_ARTIFACT_MISMATCH' ? 'TEST_INPUT_ARTIFACT_MISMATCH'
              : failure === 'OUTPUT_ARTIFACT_MISMATCH' ? 'TEST_OUTPUT_ARTIFACT_MISMATCH'
                : failure === 'ENVIRONMENT_MISMATCH' ? 'TEST_ENVIRONMENT_MISMATCH'
                  : failure === 'TEST_FILES_MISMATCH' ? 'TEST_FILES_MISMATCH'
                    : failure === 'EXECUTION_STALE' ? 'TEST_EXECUTION_STALE'
                      : failure === 'EXECUTION_TIME_INVALID' ? 'TEST_EXECUTION_TIME_INVALID'
                        : 'TEST_EXECUTION_ATTESTATION_INVALID';
        add(mapped, `Test execution provenance rejected: ${failure}.`, testRecord.recordId);
      }
    }

    const artifactRecord = input.evidenceRecords.find((record) => record.kind === 'artifact-manifest');
    if (artifactRecord === undefined || artifactRecord.payload.artifactDigest !== input.expectedArtifactDigest) {
      add('ARTIFACT_DIGEST_MISMATCH', 'The reviewed artifact digest does not match the evidence manifest.', artifactRecord?.recordId);
    }
    const unsupported = input.evidenceRecords.find((record) => record.kind === 'unsupported-claims');
    if (unsupported === undefined || !Array.isArray(unsupported.payload.claims)) {
      add('UNSUPPORTED_CLAIMS_MISSING', 'An explicit unsupported-claims register is required, including an empty register.');
    }

    const reviewers = [...new Set(input.reviewerIds)];
    if (reviewers.length === 0 || reviewers.length !== input.reviewerIds.length) add('REVIEWER_MISSING', 'At least one unique reviewer is required.');
    if (reviewers.includes(input.builderId)) add('SELF_APPROVAL', 'The builder cannot approve the same candidate.');
    if (input.rollback.ref.trim() === '' || input.rollback.verified !== true) add('ROLLBACK_MISSING', 'A verified rollback reference is required.');

    const thread = input.digitalThread.verify(input.tenantId);
    if (!thread.ok) add('DIGITAL_THREAD_INVALID', 'Digital Thread integrity verification failed.');
    const snapshot = input.digitalThread.snapshot(input.tenantId);
    for (const kind of input.requiredThreadKinds) {
      if (!snapshot.nodes.some((node) => node.kind === kind)) add('DIGITAL_THREAD_INCOMPLETE', `Digital Thread node is missing: ${kind}.`);
    }

    if (input.passport !== undefined) {
      if (!input.keyRegistry.verify(input.passport)) add('PASSPORT_INVALID', 'Action Passport signature is invalid or revoked.');
      try { validateActionPassport(input.passport.payload, now); }
      catch (error) { add('PASSPORT_INVALID', error instanceof Error ? error.message : String(error)); }
      const passportReviewers = [...input.passport.payload.reviewerIds].sort();
      if (input.passport.payload.tenantId !== input.tenantId
        || input.passport.payload.subject !== input.subjectId
        || input.passport.payload.evidenceRoot !== input.evidenceRoot
        || JSON.stringify(passportReviewers) !== JSON.stringify([...reviewers].sort())) {
        add('PASSPORT_CONFLICT', 'Action Passport conflicts with tenant, subject, evidence root, or reviewers.');
      }
    }

    const replayKey = `${input.tenantId}:${input.subjectId}:${input.evidenceRoot}`;
    const summary = {
      evidenceCount: input.evidenceRecords.length,
      requiredKindCount: input.requiredEvidenceKinds.length,
      reviewerCount: reviewers.length,
      threadNodeCount: thread.nodeCount,
      threadEdgeCount: thread.edgeCount,
    };
    if (input.consumeReplayKey !== false && failures.length === 0) {
      const consumed = this.#replayLedger.tryConsume({ replayKey, tenantId: input.tenantId, subjectId: input.subjectId, evidenceRoot: input.evidenceRoot, consumedAt: now.toISOString(), consumerId: input.builderId });
      if (!consumed) add('EVIDENCE_REPLAY', 'This evidence root has already been consumed for this subject.');
    }
    const material = {
      status: failures.length === 0 ? 'PASS' as const : 'BLOCK' as const,
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      evidenceRoot: input.evidenceRoot,
      failures,
      summary,
    };
    return { ...material, decisionDigest: sha256(material) };
  }
}
