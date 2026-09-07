import { EVIDENCE_CLASSES, type EvidenceClass } from './canonical.js';
import { sha256 } from './crypto.js';

export type RequirementCriticality = 'LOW' | 'MEDIUM' | 'HIGH' | 'SAFETY_CRITICAL';
export type VerificationMode = 'TEST' | 'FORMAL' | 'REVIEW' | 'MEASUREMENT' | 'SIMULATION';

export interface RequirementContract {
  readonly requirementId: string;
  readonly tenantId: string;
  readonly statement: string;
  readonly criticality: RequirementCriticality;
  readonly requiredEvidenceClasses: readonly EvidenceClass[];
  readonly verificationModes: readonly VerificationMode[];
  readonly acceptanceCriteria: Readonly<Record<string, unknown>>;
  readonly version: string;
}

export interface EngineeringCommitment {
  readonly commitmentId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly builderId: string;
  readonly domainPackId: string;
  readonly goal: string;
  readonly authorityGrantDigest: string;
  readonly requirementIds: readonly string[];
  readonly promotionCeiling: 'research' | 'shadow';
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface DomainPackManifest {
  readonly packId: string;
  readonly version: string;
  readonly kernelContractVersion: string;
  readonly ontologyVersion: string;
  readonly workflows: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly emittedEvidenceClasses: readonly EvidenceClass[];
  readonly requiredScopes: readonly string[];
  readonly uiSurfaces: readonly string[];
  readonly risks: readonly string[];
  readonly authorityModel: 'canonical-kernel-only';
}

export interface CertificationResult {
  readonly certificationId: string;
  readonly tenantId: string;
  readonly commitmentId: string;
  readonly requirementResults: readonly RequirementResult[];
  readonly decision: 'PASS' | 'SIMULATION_PASS' | 'INCONCLUSIVE' | 'FAIL';
  readonly evidenceRoot: string;
  readonly reviewerIds: readonly string[];
  readonly createdAt: string;
  readonly limitations: readonly string[];
}

export interface RequirementResult {
  readonly requirementId: string;
  readonly status: 'PASS' | 'INCONCLUSIVE' | 'FAIL';
  readonly evidenceRecordIds: readonly string[];
  readonly explanation: string;
}

const KERNEL_RESERVED_SCOPES = ['authority.', 'tenant.', 'secret.', 'release.', 'kernel.'];

function nonEmpty(value: string, code: string): void {
  if (value.trim() === '') throw new Error(code);
}

function validInstant(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

export function validateRequirement(requirement: RequirementContract): void {
  nonEmpty(requirement.requirementId, 'requirement_id_required');
  nonEmpty(requirement.tenantId, 'tenant_id_required');
  nonEmpty(requirement.statement, 'requirement_statement_required');
  nonEmpty(requirement.version, 'requirement_version_required');
  if (requirement.requiredEvidenceClasses.length === 0) throw new Error('required_evidence_class_required');
  if (new Set(requirement.requiredEvidenceClasses).size !== requirement.requiredEvidenceClasses.length) {
    throw new Error('duplicate_required_evidence_class');
  }
  if (requirement.requiredEvidenceClasses.some((value) => !EVIDENCE_CLASSES.includes(value))) {
    throw new Error('invalid_required_evidence_class');
  }
  if (requirement.verificationModes.length === 0) throw new Error('verification_mode_required');
  if (new Set(requirement.verificationModes).size !== requirement.verificationModes.length) {
    throw new Error('duplicate_verification_mode');
  }
}

export function validateEngineeringCommitment(commitment: EngineeringCommitment, now = new Date()): void {
  nonEmpty(commitment.commitmentId, 'commitment_id_required');
  nonEmpty(commitment.tenantId, 'tenant_id_required');
  nonEmpty(commitment.subjectId, 'subject_id_required');
  nonEmpty(commitment.builderId, 'builder_id_required');
  nonEmpty(commitment.domainPackId, 'domain_pack_id_required');
  nonEmpty(commitment.goal, 'commitment_goal_required');
  nonEmpty(commitment.authorityGrantDigest, 'authority_grant_digest_required');
  if (commitment.requirementIds.length === 0) throw new Error('commitment_requirement_required');
  if (new Set(commitment.requirementIds).size !== commitment.requirementIds.length) {
    throw new Error('duplicate_commitment_requirement');
  }
  if (commitment.promotionCeiling !== 'research' && commitment.promotionCeiling !== 'shadow') {
    throw new Error('invalid_promotion_ceiling');
  }
  const created = validInstant(commitment.createdAt, 'invalid_commitment_created_at');
  const expires = validInstant(commitment.expiresAt, 'invalid_commitment_expires_at');
  if (expires <= created) throw new Error('invalid_commitment_expiry');
  if (now.getTime() >= expires) throw new Error('commitment_expired');
}

export function validateDomainPackManifest(manifest: DomainPackManifest): void {
  for (const [value, code] of [
    [manifest.packId, 'pack_id_required'],
    [manifest.version, 'pack_version_required'],
    [manifest.kernelContractVersion, 'kernel_contract_version_required'],
    [manifest.ontologyVersion, 'ontology_version_required'],
  ] as const) nonEmpty(value, code);
  if (manifest.authorityModel !== 'canonical-kernel-only') throw new Error('domain_pack_authority_forbidden');
  if (manifest.workflows.length === 0) throw new Error('domain_pack_workflow_required');
  if (new Set(manifest.requiredScopes).size !== manifest.requiredScopes.length) throw new Error('duplicate_domain_scope');
  if (manifest.requiredScopes.some((scope) => scope === '*' || scope.endsWith('.*'))) {
    throw new Error('domain_pack_wildcard_scope_forbidden');
  }
  if (manifest.requiredScopes.some((scope) => KERNEL_RESERVED_SCOPES.some((prefix) => scope.startsWith(prefix)))) {
    throw new Error('domain_pack_kernel_scope_forbidden');
  }
  if (manifest.emittedEvidenceClasses.some((value) => !EVIDENCE_CLASSES.includes(value))) {
    throw new Error('domain_pack_invalid_evidence_class');
  }
}

export function commitmentDigest(commitment: EngineeringCommitment): string {
  validateEngineeringCommitment(commitment, new Date(commitment.createdAt));
  return sha256(commitment);
}

export function requirementDigest(requirement: RequirementContract): string {
  validateRequirement(requirement);
  return sha256(requirement);
}
