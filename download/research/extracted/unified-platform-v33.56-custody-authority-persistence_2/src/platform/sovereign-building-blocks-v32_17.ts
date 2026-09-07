import { sha256, type KeyRegistry, type SignedEnvelope } from '../contracts/crypto.js';

export type SovereignBuildingBlockV32_17 =
  | 'service-invocation'
  | 'state'
  | 'pubsub'
  | 'workflow'
  | 'bindings'
  | 'secrets'
  | 'configuration'
  | 'distributed-lock';

export type ComponentEvidenceClassV32_17 = 'SYNTHETIC' | 'OBSERVED_LOCAL' | 'OBSERVED_EXTERNAL';
export type ComponentAdmissionV32_17 = 'REJECT' | 'DRY_RUN_ONLY' | 'ADMIT';

export interface SovereignComponentManifestV32_17 {
  readonly schemaVersion: '32.17';
  readonly componentId: string;
  readonly version: string;
  readonly protocolProfile: 'dapr-building-blocks-v1';
  readonly endpoint: { readonly transport: 'unix-domain-socket' | 'loopback-http' | 'loopback-grpc'; readonly address: string };
  readonly blocks: readonly SovereignBuildingBlockV32_17[];
  readonly interfaceVersions: Readonly<Record<SovereignBuildingBlockV32_17, string | undefined>>;
  readonly spiffeId: string;
  readonly publisherId: string;
  readonly publisherOrganizationId: string;
  readonly reviewerId: string;
  readonly reviewerOrganizationId: string;
  readonly publisherKeyFingerprint: string;
  readonly reviewerKeyFingerprint: string;
  readonly binaryDigest: string;
  readonly sourceDigest: string;
  readonly toolchainDigest: string;
  readonly policyDigest: string;
  readonly maximumMemoryBytes: number;
  readonly maximumConcurrency: number;
  readonly networkEgress: 'NONE' | 'ALLOWLISTED';
  readonly deterministic: boolean;
  readonly evidenceClass: ComponentEvidenceClassV32_17;
  readonly runtimeQualified: boolean;
  readonly synthetic: boolean;
  readonly normalizedMonthlyCost: number;
  readonly operationalUnits: number;
}

export interface SovereignComponentPolicyV32_17 {
  readonly policyDigest: string;
  readonly allowedTrustDomains: readonly string[];
  readonly allowedBlocks: readonly SovereignBuildingBlockV32_17[];
  readonly requiredInterfaceVersions: Readonly<Partial<Record<SovereignBuildingBlockV32_17, string>>>;
  readonly maximumBlocksPerComponent: number;
  readonly maximumMemoryBytes: number;
  readonly maximumConcurrency: number;
  readonly requireIndependentReview: boolean;
  readonly requireUnixDomainSocketForPrivateComponents: boolean;
  readonly requireDeterminismFor: readonly SovereignBuildingBlockV32_17[];
  readonly allowNetworkEgressFor: readonly SovereignBuildingBlockV32_17[];
  readonly production: boolean;
}


export interface ComponentActorAuthorizationV32_17 {
  readonly role: 'PUBLISHER' | 'REVIEWER';
  readonly actorId: string;
  readonly organizationId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly authority: 'EXTERNAL_PINNED';
}

export interface ComponentPublisherAttestationV32_17 {
  readonly schemaVersion: '32.17';
  readonly role: 'PUBLISHER';
  readonly componentId: string;
  readonly manifestDigest: string;
  readonly binaryDigest: string;
  readonly sourceDigest: string;
  readonly toolchainDigest: string;
  readonly policyDigest: string;
  readonly actorId: string;
  readonly organizationId: string;
  readonly keyFingerprint: string;
  readonly observedAt: string;
}

export interface ComponentReviewerAttestationV32_17 {
  readonly schemaVersion: '32.17';
  readonly role: 'REVIEWER';
  readonly componentId: string;
  readonly manifestDigest: string;
  readonly publisherAttestationDigest: string;
  readonly policyDigest: string;
  readonly decision: 'APPROVE';
  readonly actorId: string;
  readonly organizationId: string;
  readonly keyFingerprint: string;
  readonly reviewedAt: string;
}

export interface ComponentAdmissionTrustV32_17 {
  readonly registry: KeyRegistry;
  readonly authorizations: readonly ComponentActorAuthorizationV32_17[];
  readonly publisher: SignedEnvelope<ComponentPublisherAttestationV32_17>;
  readonly reviewer: SignedEnvelope<ComponentReviewerAttestationV32_17>;
  readonly evaluatedAt: string;
}

export interface SovereignComponentAdmissionReportV32_17 {
  readonly schemaVersion: '32.17';
  readonly componentId: string;
  readonly admission: ComponentAdmissionV32_17;
  readonly productionQualified: boolean;
  readonly findings: readonly string[];
  readonly admittedBlocks: readonly SovereignBuildingBlockV32_17[];
  readonly reportDigest: string;
}

export interface SovereignBuildingBlockPlanPolicyV32_17 {
  readonly requiredBlocks: readonly SovereignBuildingBlockV32_17[];
  readonly maximumComponents: number;
  readonly maximumSingleComponentCoverage: number;
  readonly minimumDistinctOrganizations: number;
  readonly costWeight: number;
  readonly operationalWeight: number;
  readonly concentrationWeight: number;
  readonly production: boolean;
}

export interface SovereignBuildingBlockPlanV32_17 {
  readonly schemaVersion: '32.17';
  readonly state: 'REJECTED' | 'DRY_RUN_VALID' | 'PRODUCTION_READY';
  readonly productionQualified: boolean;
  readonly selectedComponentIds: readonly string[];
  readonly coveredBlocks: readonly SovereignBuildingBlockV32_17[];
  readonly uncoveredBlocks: readonly SovereignBuildingBlockV32_17[];
  readonly distinctOrganizations: number;
  readonly normalizedMonthlyCost: number;
  readonly operationalUnits: number;
  readonly concentration: number;
  readonly score: number;
  readonly findings: readonly string[];
  readonly planDigest: string;
}

export function componentManifestDigestV32_17(manifest: SovereignComponentManifestV32_17): string {
  validateManifest(manifest);
  const material = { ...manifest, interfaceVersions: Object.fromEntries(manifest.blocks.map((block) => [block, manifest.interfaceVersions[block]])) };
  return sha256(material);
}

export function evaluateSovereignComponentV32_17(
  manifest: SovereignComponentManifestV32_17,
  policy: SovereignComponentPolicyV32_17,
  trust?: ComponentAdmissionTrustV32_17,
): SovereignComponentAdmissionReportV32_17 {
  validateManifest(manifest);
  validatePolicy(policy);
  const findings: string[] = [];
  if (manifest.policyDigest !== policy.policyDigest) findings.push('component-policy-digest-mismatch');
  const trustDomain = parseSpiffeTrustDomain(manifest.spiffeId);
  if (!policy.allowedTrustDomains.includes(trustDomain)) findings.push('component-spiffe-trust-domain-denied');
  const uniqueBlocks = [...new Set(manifest.blocks)];
  if (uniqueBlocks.length !== manifest.blocks.length) findings.push('component-block-duplicate');
  if (manifest.blocks.length > policy.maximumBlocksPerComponent) findings.push('component-block-concentration-exceeded');
  for (const block of manifest.blocks) {
    if (!policy.allowedBlocks.includes(block)) findings.push(`component-block-denied:${block}`);
    const required = policy.requiredInterfaceVersions[block];
    const observed = manifest.interfaceVersions[block];
    if (required !== undefined && observed !== required) findings.push(`component-interface-version-mismatch:${block}`);
    if (observed === undefined) findings.push(`component-interface-version-missing:${block}`);
    if (policy.requireDeterminismFor.includes(block) && !manifest.deterministic) findings.push(`component-determinism-required:${block}`);
    if (manifest.networkEgress === 'ALLOWLISTED' && !policy.allowNetworkEgressFor.includes(block)) findings.push(`component-network-egress-denied:${block}`);
  }
  if (policy.requireUnixDomainSocketForPrivateComponents && manifest.endpoint.transport !== 'unix-domain-socket') findings.push('component-private-transport-not-uds');
  if (manifest.endpoint.transport === 'unix-domain-socket' && !/^\/[a-zA-Z0-9._/-]+\.sock$/.test(manifest.endpoint.address)) findings.push('component-uds-address-invalid');
  if (manifest.maximumMemoryBytes > policy.maximumMemoryBytes) findings.push('component-memory-limit-exceeded');
  if (manifest.maximumConcurrency > policy.maximumConcurrency) findings.push('component-concurrency-limit-exceeded');
  if (policy.requireIndependentReview && (
    manifest.publisherId === manifest.reviewerId
    || manifest.publisherOrganizationId === manifest.reviewerOrganizationId
    || manifest.publisherKeyFingerprint === manifest.reviewerKeyFingerprint
  )) findings.push('component-independent-review-required');
  if (manifest.evidenceClass === 'OBSERVED_EXTERNAL' && (!manifest.runtimeQualified || manifest.synthetic)) findings.push('component-external-evidence-invalid');
  const trustValid = policy.production ? validateProductionTrust(manifest, policy, trust, findings) : false;
  const productionQualified = findings.length === 0
    && policy.production
    && trustValid
    && manifest.evidenceClass === 'OBSERVED_EXTERNAL'
    && manifest.runtimeQualified
    && !manifest.synthetic;
  const admission: ComponentAdmissionV32_17 = findings.length > 0
    ? 'REJECT'
    : productionQualified
      ? 'ADMIT'
      : 'DRY_RUN_ONLY';
  const material = {
    schemaVersion: '32.17' as const,
    componentId: manifest.componentId,
    admission,
    productionQualified,
    findings: findings.sort(),
    admittedBlocks: admission === 'REJECT' ? [] : [...manifest.blocks].sort(),
  };
  return { ...material, reportDigest: sha256(material) };
}

export function optimizeSovereignBuildingBlockPlanV32_17(
  manifests: readonly SovereignComponentManifestV32_17[],
  admissions: readonly SovereignComponentAdmissionReportV32_17[],
  policy: SovereignBuildingBlockPlanPolicyV32_17,
): SovereignBuildingBlockPlanV32_17 {
  validatePlanPolicy(policy);
  if (manifests.length !== admissions.length) throw new Error('building_block_plan_input_length_mismatch');
  const admissionById = new Map(admissions.map((item) => [item.componentId, item]));
  if (admissionById.size !== admissions.length) throw new Error('building_block_plan_admission_duplicate');
  const candidates = manifests.filter((manifest) => {
    const admission = admissionById.get(manifest.componentId);
    return admission !== undefined && admission.admission !== 'REJECT';
  });
  let best: { manifests: SovereignComponentManifestV32_17[]; score: number; covered: Set<SovereignBuildingBlockV32_17>; organizations: Set<string>; cost: number; units: number; concentration: number } | undefined;
  const limit = 1 << candidates.length;
  if (candidates.length > 20) throw new Error('building_block_plan_candidate_limit_exceeded');
  for (let mask = 1; mask < limit; mask += 1) {
    const selected = candidates.filter((_, index) => (mask & (1 << index)) !== 0);
    if (selected.length > policy.maximumComponents) continue;
    const covered = new Set(selected.flatMap((item) => [...item.blocks]));
    if (!policy.requiredBlocks.every((block) => covered.has(block))) continue;
    const organizations = new Set(selected.map((item) => item.publisherOrganizationId));
    if (organizations.size < policy.minimumDistinctOrganizations) continue;
    const cost = selected.reduce((sum, item) => sum + item.normalizedMonthlyCost, 0);
    const units = selected.reduce((sum, item) => sum + item.operationalUnits, 0);
    const maxCoverage = Math.max(...selected.map((item) => item.blocks.length));
    const concentration = Number((maxCoverage / policy.requiredBlocks.length).toFixed(6));
    if (concentration > policy.maximumSingleComponentCoverage) continue;
    const score = Number((cost * policy.costWeight + units * policy.operationalWeight + concentration * policy.concentrationWeight).toFixed(6));
    const ids = selected.map((item) => item.componentId).sort().join('|');
    const bestIds = best?.manifests.map((item) => item.componentId).sort().join('|');
    if (best === undefined || score < best.score || (score === best.score && ids.localeCompare(bestIds ?? '') < 0)) {
      best = { manifests: selected, score, covered, organizations, cost, units, concentration };
    }
  }
  const findings: string[] = [];
  if (best === undefined) findings.push('building-block-plan-no-valid-topology');
  const selected = best?.manifests ?? [];
  const coveredBlocks = [...(best?.covered ?? new Set<SovereignBuildingBlockV32_17>())].sort();
  const uncoveredBlocks = policy.requiredBlocks.filter((block) => !coveredBlocks.includes(block)).sort();
  const productionQualified = best !== undefined
    && policy.production
    && selected.every((manifest) => admissionById.get(manifest.componentId)?.productionQualified === true);
  const state: SovereignBuildingBlockPlanV32_17['state'] = best === undefined ? 'REJECTED' : productionQualified ? 'PRODUCTION_READY' : 'DRY_RUN_VALID';
  const material = {
    schemaVersion: '32.17' as const,
    state,
    productionQualified,
    selectedComponentIds: selected.map((item) => item.componentId).sort(),
    coveredBlocks,
    uncoveredBlocks,
    distinctOrganizations: best?.organizations.size ?? 0,
    normalizedMonthlyCost: best?.cost ?? 0,
    operationalUnits: best?.units ?? 0,
    concentration: best?.concentration ?? 0,
    score: best?.score ?? Number.MAX_SAFE_INTEGER,
    findings,
  };
  return { ...material, planDigest: sha256(material) };
}


function validateProductionTrust(
  manifest: SovereignComponentManifestV32_17,
  policy: SovereignComponentPolicyV32_17,
  trust: ComponentAdmissionTrustV32_17 | undefined,
  findings: string[],
): boolean {
  if (trust === undefined) { findings.push('component-production-trust-missing'); return false; }
  const evaluatedAt = Date.parse(trust.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) { findings.push('component-trust-evaluation-time-invalid'); return false; }
  const publisher = trust.publisher.payload;
  const reviewer = trust.reviewer.payload;
  const manifestDigest = componentManifestDigestV32_17(manifest);
  const publisherDigest = sha256(publisher);
  const publisherAuthorization = trust.authorizations.find((item) => item.role === 'PUBLISHER' && item.actorId === manifest.publisherId);
  const reviewerAuthorization = trust.authorizations.find((item) => item.role === 'REVIEWER' && item.actorId === manifest.reviewerId);
  for (const [role, authorization, expectedOrganization, expectedFingerprint, envelope] of [
    ['publisher', publisherAuthorization, manifest.publisherOrganizationId, manifest.publisherKeyFingerprint, trust.publisher],
    ['reviewer', reviewerAuthorization, manifest.reviewerOrganizationId, manifest.reviewerKeyFingerprint, trust.reviewer],
  ] as const) {
    if (authorization === undefined || authorization.authority !== 'EXTERNAL_PINNED') { findings.push(`component-${role}-authorization-missing`); continue; }
    const from = Date.parse(authorization.validFrom); const until = Date.parse(authorization.validUntil);
    if (!Number.isFinite(from) || !Number.isFinite(until) || from > evaluatedAt || evaluatedAt > until) findings.push(`component-${role}-authorization-expired`);
    if (authorization.organizationId !== expectedOrganization || authorization.keyFingerprint !== expectedFingerprint || authorization.keyId !== envelope.issuerKeyId) findings.push(`component-${role}-authorization-mismatch`);
    if (trust.registry.fingerprint(authorization.keyId) !== authorization.keyFingerprint) findings.push(`component-${role}-key-fingerprint-mismatch`);
  }
  if (!trust.registry.verifyAt(trust.publisher, publisher.observedAt)) findings.push('component-publisher-signature-invalid');
  if (!trust.registry.verifyAt(trust.reviewer, reviewer.reviewedAt)) findings.push('component-reviewer-signature-invalid');
  if (publisher.schemaVersion !== '32.17' || publisher.role !== 'PUBLISHER' || publisher.componentId !== manifest.componentId || publisher.manifestDigest !== manifestDigest || publisher.binaryDigest !== manifest.binaryDigest || publisher.sourceDigest !== manifest.sourceDigest || publisher.toolchainDigest !== manifest.toolchainDigest || publisher.policyDigest !== policy.policyDigest || publisher.actorId !== manifest.publisherId || publisher.organizationId !== manifest.publisherOrganizationId || publisher.keyFingerprint !== manifest.publisherKeyFingerprint) findings.push('component-publisher-attestation-lineage-invalid');
  if (reviewer.schemaVersion !== '32.17' || reviewer.role !== 'REVIEWER' || reviewer.componentId !== manifest.componentId || reviewer.manifestDigest !== manifestDigest || reviewer.publisherAttestationDigest !== publisherDigest || reviewer.policyDigest !== policy.policyDigest || reviewer.decision !== 'APPROVE' || reviewer.actorId !== manifest.reviewerId || reviewer.organizationId !== manifest.reviewerOrganizationId || reviewer.keyFingerprint !== manifest.reviewerKeyFingerprint) findings.push('component-reviewer-attestation-lineage-invalid');
  const observedAt = Date.parse(publisher.observedAt); const reviewedAt = Date.parse(reviewer.reviewedAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(reviewedAt) || observedAt > reviewedAt || reviewedAt > evaluatedAt) findings.push('component-attestation-time-order-invalid');
  if (trust.authorizations.length !== 2 || publisherAuthorization?.keyId === reviewerAuthorization?.keyId || publisher.actorId === reviewer.actorId || publisher.organizationId === reviewer.organizationId || publisher.keyFingerprint === reviewer.keyFingerprint) findings.push('component-trust-independence-invalid');
  return !findings.some((finding) => finding.startsWith('component-production-trust') || finding.startsWith('component-publisher-') || finding.startsWith('component-reviewer-') || finding.startsWith('component-attestation-') || finding.startsWith('component-trust-'));
}

function validateManifest(manifest: SovereignComponentManifestV32_17): void {
  if (manifest.schemaVersion !== '32.17' || manifest.protocolProfile !== 'dapr-building-blocks-v1') throw new Error('component_manifest_schema_invalid');
  if ([manifest.componentId, manifest.version, manifest.publisherId, manifest.publisherOrganizationId, manifest.reviewerId, manifest.reviewerOrganizationId].some((value) => value.trim() === '')) throw new Error('component_manifest_identity_invalid');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('component_manifest_version_invalid');
  if (![manifest.publisherKeyFingerprint, manifest.reviewerKeyFingerprint, manifest.binaryDigest, manifest.sourceDigest, manifest.toolchainDigest, manifest.policyDigest].every(isDigest)) throw new Error('component_manifest_digest_invalid');
  if (!Number.isSafeInteger(manifest.maximumMemoryBytes) || manifest.maximumMemoryBytes <= 0 || !Number.isSafeInteger(manifest.maximumConcurrency) || manifest.maximumConcurrency <= 0) throw new Error('component_manifest_limits_invalid');
  if (!Number.isFinite(manifest.normalizedMonthlyCost) || manifest.normalizedMonthlyCost < 0 || !Number.isSafeInteger(manifest.operationalUnits) || manifest.operationalUnits <= 0) throw new Error('component_manifest_cost_invalid');
  parseSpiffeTrustDomain(manifest.spiffeId);
  for (const block of manifest.blocks) {
    if (!ALL_BLOCKS.includes(block)) throw new Error('component_manifest_block_invalid');
    const version = manifest.interfaceVersions[block];
    if (version !== undefined && !/^v\d+(?:alpha\d+|beta\d+)?$/.test(version)) throw new Error('component_manifest_interface_version_invalid');
  }
}
function validatePolicy(policy: SovereignComponentPolicyV32_17): void {
  if (!isDigest(policy.policyDigest) || policy.allowedTrustDomains.length === 0 || policy.allowedBlocks.length === 0) throw new Error('component_policy_invalid');
  if (!Number.isSafeInteger(policy.maximumBlocksPerComponent) || policy.maximumBlocksPerComponent <= 0 || !Number.isSafeInteger(policy.maximumMemoryBytes) || policy.maximumMemoryBytes <= 0 || !Number.isSafeInteger(policy.maximumConcurrency) || policy.maximumConcurrency <= 0) throw new Error('component_policy_limits_invalid');
  for (const domain of policy.allowedTrustDomains) if (!/^[a-z0-9.-]+$/.test(domain) || domain.startsWith('.') || domain.endsWith('.')) throw new Error('component_policy_trust_domain_invalid');
  for (const block of [...policy.allowedBlocks, ...policy.requireDeterminismFor, ...policy.allowNetworkEgressFor]) if (!ALL_BLOCKS.includes(block)) throw new Error('component_policy_block_invalid');
}
function validatePlanPolicy(policy: SovereignBuildingBlockPlanPolicyV32_17): void {
  if (policy.requiredBlocks.length === 0 || new Set(policy.requiredBlocks).size !== policy.requiredBlocks.length) throw new Error('building_block_plan_required_invalid');
  if (!Number.isSafeInteger(policy.maximumComponents) || policy.maximumComponents <= 0 || !Number.isSafeInteger(policy.minimumDistinctOrganizations) || policy.minimumDistinctOrganizations <= 0) throw new Error('building_block_plan_limit_invalid');
  for (const value of [policy.maximumSingleComponentCoverage, policy.costWeight, policy.operationalWeight, policy.concentrationWeight]) if (!Number.isFinite(value) || value < 0) throw new Error('building_block_plan_weight_invalid');
  if (policy.maximumSingleComponentCoverage <= 0 || policy.maximumSingleComponentCoverage > 1) throw new Error('building_block_plan_concentration_invalid');
}
function parseSpiffeTrustDomain(spiffeId: string): string {
  const match = /^spiffe:\/\/([a-z0-9.-]+)\/[a-zA-Z0-9._~!$&'()*+,;=:@/-]+$/.exec(spiffeId);
  if (match === null || match[1] === undefined) throw new Error('component_spiffe_id_invalid');
  return match[1];
}
function isDigest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
const ALL_BLOCKS: readonly SovereignBuildingBlockV32_17[] = ['bindings','configuration','distributed-lock','pubsub','secrets','service-invocation','state','workflow'];
