import type { ArtifactRecord } from '../artifacts/content-addressed-store.js';
import type { CapabilityTrustState, TrustViolationSeverity } from './capability-trust.js';
import type { FailureKnowledgePackage } from './failure-knowledge.js';

export type IncidentCategory =
  | 'DUPLICATE_SIDE_EFFECT'
  | 'TENANT_LEAKAGE'
  | 'FALSE_COMPLETION_CLAIM'
  | 'INVALID_WEBHOOK'
  | 'ARTIFACT_TAMPERING'
  | 'KEY_COMPROMISE'
  | 'SCIENTIFIC_HONESTY_VIOLATION'
  | 'TEST_DELETION'
  | 'DATABASE_RECOVERY_INCIDENT'
  | 'ROLLBACK_FAILURE';

export interface GovernedIncident {
  readonly incidentId: string;
  readonly tenantId: string;
  readonly capabilityRef: string;
  readonly category: IncidentCategory;
  readonly severity: TrustViolationSeverity;
  readonly subject: string;
  readonly evidenceRefs: readonly string[];
  readonly affectedContracts: readonly string[];
  readonly affectedArtifacts: readonly string[];
  readonly reportedBy: string;
  readonly occurredAt: string;
  readonly summary: string;
}

export interface RecertificationPlan {
  readonly caseId: string;
  readonly tenantId: string;
  readonly capabilityRef: string;
  readonly incidentId: string;
  readonly status: 'OPEN' | 'RECERTIFIED' | 'NEW_VERSION_REQUIRED';
  readonly regressionTest: string;
  readonly adversarialTest: string;
  readonly runtimeMonitor: string;
  readonly recertificationTrigger: string;
  readonly requiredEvidenceKinds: readonly ['regression-test', 'runtime-monitor', 'artifact-integrity'];
  readonly trustStateAfterIncident: CapabilityTrustState;
  readonly failureKnowledge: FailureKnowledgePackage;
  readonly incidentArtifact: ArtifactRecord;
  readonly planArtifact: ArtifactRecord;
  readonly digitalThreadRoot: string;
  readonly createdAt: string;
}

export interface RecertificationResult {
  readonly caseId: string;
  readonly status: 'RECERTIFIED';
  readonly capabilityState: CapabilityTrustState;
  readonly evidenceRoot: string;
  readonly reviewerIds: readonly string[];
  readonly digitalThreadRoot: string;
  readonly certificationDigest: string;
}
