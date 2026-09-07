import { KeyRegistry, type SignedEnvelope, type SigningIdentity, sha256, signEnvelope } from '../contracts/crypto.js';
import {
  type DescriptorPinnedRepositoryManifestV33_13,
  type HostIsolationCapabilityAttestationV33_13,
  type IsolationRuntimeAdapterV33_13,
  captureDescriptorPinnedRepositoryManifestV33_13,
  verifyHostIsolationCapabilityAttestationV33_13,
} from './isolation-runtime-contract-v33_13.js';
import {
  type QualifiedIsolationReceiptV33_12,
  executeQualifiedHostileCodeV33_12,
  verifyQualifiedIsolationReceiptV33_12,
} from './qualified-hostile-code-isolation-v33_12.js';

export type QualifiedHostileExecutionRequestV33_13 = Omit<Parameters<typeof executeQualifiedHostileCodeV33_12>[0], 'signer'>;

export interface AdapterExecutionEvidenceV33_13 {
  readonly version: '33.13';
  readonly adapterId: string;
  readonly adapterImplementation: 'LOCAL_LINUX_NAMESPACE_V33_12_ADAPTER';
  readonly capabilityAttestationDigest: string;
  readonly runtimeReceiptDigest: string;
  readonly executedAt: string;
  readonly externalEffectsExecuted: 0;
  readonly productionPromotion: 'blocked';
  readonly evidenceDigest: string;
}

export interface OrchestratedIsolationBundleV33_13 {
  readonly version: '33.13';
  readonly bundleId: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly capabilityAttestationDigest: string;
  readonly snapshotManifestBeforeDigest: string;
  readonly snapshotManifestAfterDigest: string;
  readonly sourceStable: boolean;
  readonly adapterEvidenceDigest: string;
  readonly runtimeReceiptDigest: string;
  readonly admissionSignerId: string;
  readonly capabilitySignerId: string;
  readonly challengeSignerId?: string;
  readonly runtimeSignerId: string;
  readonly orchestratorSignerId: string;
  readonly separationOfDutiesSatisfied: boolean;
  readonly evidenceClass: 'LOCAL_REFERENCE_MULTI_ROLE_QUALIFICATION';
  readonly openat2Qualified: false;
  readonly seccompQualified: false;
  readonly cgroupV2Qualified: false;
  readonly secondRuntimeQualified: false;
  readonly multiHostQualified: false;
  readonly productionPromotion: 'blocked';
  readonly externalQualification: 'not_executed';
  readonly limitations: readonly string[];
  readonly bundleDigest: string;
}

export interface IndependentIsolationVerdictV33_13 {
  readonly version: '33.13';
  readonly verdictId: string;
  readonly bundleDigest: string;
  readonly runtimeReceiptDigest: string;
  readonly status: 'REFERENCE_QUALIFIED' | 'REJECTED';
  readonly promotionCeiling: 'research';
  readonly verifierSignerId: string;
  readonly independentFromAdmission: boolean;
  readonly independentFromChallenge: boolean;
  readonly independentFromCapability: boolean;
  readonly independentFromRuntime: boolean;
  readonly independentFromOrchestrator: boolean;
  readonly unsupportedControls: readonly ['OPENAT2', 'SECCOMP', 'CGROUP_V2', 'SECOND_RUNTIME', 'MULTI_HOST', 'EXTERNAL_WITNESS'];
  readonly productionPromotion: 'blocked';
  readonly externalQualification: 'not_executed';
  readonly verifiedAt: string;
  readonly verdictDigest: string;
}

export function createLocalNamespaceRuntimeAdapterV33_13(input: {
  readonly adapterId: string;
  readonly runtimeSigner: SigningIdentity;
  readonly capabilityAttestation: SignedEnvelope<HostIsolationCapabilityAttestationV33_13>;
}): IsolationRuntimeAdapterV33_13<QualifiedHostileExecutionRequestV33_13, {
  readonly runtimeReceipt: SignedEnvelope<QualifiedIsolationReceiptV33_12>;
  readonly adapterEvidence: SignedEnvelope<AdapterExecutionEvidenceV33_13>;
}> {
  if (input.adapterId.trim() === '') throw new Error('runtime_adapter_id_required');
  return {
    adapterId: input.adapterId,
    implementation: 'LOCAL_LINUX_NAMESPACE_V33_12_ADAPTER',
    execute: (request) => {
      const runtimeReceipt = executeQualifiedHostileCodeV33_12({ ...request, signer: input.runtimeSigner });
      const material = {
        version: '33.13' as const,
        adapterId: input.adapterId,
        adapterImplementation: 'LOCAL_LINUX_NAMESPACE_V33_12_ADAPTER' as const,
        capabilityAttestationDigest: input.capabilityAttestation.payload.attestationDigest,
        runtimeReceiptDigest: runtimeReceipt.payload.receiptDigest,
        executedAt: runtimeReceipt.payload.completedAt,
        externalEffectsExecuted: 0 as const,
        productionPromotion: 'blocked' as const,
      };
      return {
        runtimeReceipt,
        adapterEvidence: signEnvelope({ ...material, evidenceDigest: sha256(material) }, input.runtimeSigner),
      };
    },
  };
}

export function executeOrchestratedHostileCodeV33_13(input: {
  readonly bundleId: string;
  readonly request: QualifiedHostileExecutionRequestV33_13;
  readonly adapter: IsolationRuntimeAdapterV33_13<QualifiedHostileExecutionRequestV33_13, {
    readonly runtimeReceipt: SignedEnvelope<QualifiedIsolationReceiptV33_12>;
    readonly adapterEvidence: SignedEnvelope<AdapterExecutionEvidenceV33_13>;
  }>;
  readonly capabilityAttestation: SignedEnvelope<HostIsolationCapabilityAttestationV33_13>;
  readonly capabilityKeys: KeyRegistry;
  readonly trustedCapabilitySignerIds: readonly string[];
  readonly runtimeKeys: KeyRegistry;
  readonly trustedRuntimeSignerIds: readonly string[];
  readonly orchestratorSigner: SigningIdentity;
}): {
  readonly snapshotBefore: DescriptorPinnedRepositoryManifestV33_13;
  readonly snapshotAfter: DescriptorPinnedRepositoryManifestV33_13;
  readonly runtimeReceipt: SignedEnvelope<QualifiedIsolationReceiptV33_12>;
  readonly adapterEvidence: SignedEnvelope<AdapterExecutionEvidenceV33_13>;
  readonly bundle: SignedEnvelope<OrchestratedIsolationBundleV33_13>;
} {
  if (!verifyHostIsolationCapabilityAttestationV33_13({
    envelope: input.capabilityAttestation,
    keys: input.capabilityKeys,
    trustedSignerIds: input.trustedCapabilitySignerIds,
    at: input.request.startedAt,
  })) throw new Error('host_capability_attestation_invalid');
  if (input.capabilityAttestation.payload.localNamespaceRuntime !== 'VERIFIED_AVAILABLE') throw new Error('host_local_namespace_unavailable');

  const roleIds = [
    input.request.admissionEnvelope.issuerKeyId,
    input.request.challengeAuthorization?.issuerKeyId,
    input.capabilityAttestation.issuerKeyId,
    input.orchestratorSigner.keyId,
  ].filter((value): value is string => value !== undefined);
  if (new Set(roleIds).size !== roleIds.length) throw new Error('orchestrator_role_separation_invalid');

  const snapshotBefore = captureDescriptorPinnedRepositoryManifestV33_13(input.request.root);
  const executed = input.adapter.execute(input.request);
  const snapshotAfter = captureDescriptorPinnedRepositoryManifestV33_13(input.request.root);
  const runtimeSignerId = executed.runtimeReceipt.issuerKeyId;
  if (roleIds.includes(runtimeSignerId)) throw new Error('runtime_role_separation_invalid');
  if (!input.trustedRuntimeSignerIds.includes(runtimeSignerId)
    || !verifyQualifiedIsolationReceiptV33_12({ envelope: executed.runtimeReceipt, keys: input.runtimeKeys, trustedSignerIds: input.trustedRuntimeSignerIds })
    || !input.runtimeKeys.verifyAt(executed.adapterEvidence, executed.adapterEvidence.payload.executedAt)) throw new Error('runtime_adapter_signature_invalid');
  if (executed.adapterEvidence.issuerKeyId !== runtimeSignerId) throw new Error('adapter_runtime_signer_mismatch');
  if (executed.adapterEvidence.payload.runtimeReceiptDigest !== executed.runtimeReceipt.payload.receiptDigest
    || executed.adapterEvidence.payload.capabilityAttestationDigest !== input.capabilityAttestation.payload.attestationDigest
    || executed.adapterEvidence.payload.adapterId !== input.adapter.adapterId) throw new Error('adapter_evidence_binding_invalid');

  const sourceStable = snapshotBefore.manifestDigest === snapshotAfter.manifestDigest;
  if (!sourceStable || !executed.runtimeReceipt.payload.sourceUnchanged) throw new Error('orchestrated_source_changed');
  const material = {
    version: '33.13' as const,
    bundleId: required(input.bundleId, 'orchestrated_bundle_id_required'),
    tenantId: input.request.tenantId,
    repositoryId: input.request.repositoryId,
    capabilityAttestationDigest: input.capabilityAttestation.payload.attestationDigest,
    snapshotManifestBeforeDigest: snapshotBefore.manifestDigest,
    snapshotManifestAfterDigest: snapshotAfter.manifestDigest,
    sourceStable,
    adapterEvidenceDigest: executed.adapterEvidence.payload.evidenceDigest,
    runtimeReceiptDigest: executed.runtimeReceipt.payload.receiptDigest,
    admissionSignerId: input.request.admissionEnvelope.issuerKeyId,
    capabilitySignerId: input.capabilityAttestation.issuerKeyId,
    ...(input.request.challengeAuthorization === undefined ? {} : { challengeSignerId: input.request.challengeAuthorization.issuerKeyId }),
    runtimeSignerId,
    orchestratorSignerId: input.orchestratorSigner.keyId,
    separationOfDutiesSatisfied: true,
    evidenceClass: 'LOCAL_REFERENCE_MULTI_ROLE_QUALIFICATION' as const,
    openat2Qualified: false as const,
    seccompQualified: false as const,
    cgroupV2Qualified: false as const,
    secondRuntimeQualified: false as const,
    multiHostQualified: false as const,
    productionPromotion: 'blocked' as const,
    externalQualification: 'not_executed' as const,
    limitations: [
      'DESCRIPTOR_PINNING_IS_PARTIAL_WITHOUT_OPENAT2',
      'LOCAL_NAMESPACE_RUNTIME_DELEGATES_TO_V33_12_REFERENCE',
      'NO_SECCOMP_EXECUTED_PROOF',
      'NO_CGROUP_V2_EXECUTED_PROOF',
      'NO_SECOND_RUNTIME',
      'NO_MULTI_HOST',
      'NO_EXTERNAL_WITNESS',
    ],
  };
  return {
    snapshotBefore,
    snapshotAfter,
    runtimeReceipt: executed.runtimeReceipt,
    adapterEvidence: executed.adapterEvidence,
    bundle: signEnvelope({ ...material, bundleDigest: sha256(material) }, input.orchestratorSigner),
  };
}

export function independentlyVerifyIsolationBundleV33_13(input: {
  readonly verdictId: string;
  readonly verifiedAt: string;
  readonly bundle: SignedEnvelope<OrchestratedIsolationBundleV33_13>;
  readonly runtimeReceipt: SignedEnvelope<QualifiedIsolationReceiptV33_12>;
  readonly adapterEvidence: SignedEnvelope<AdapterExecutionEvidenceV33_13>;
  readonly capabilityAttestation: SignedEnvelope<HostIsolationCapabilityAttestationV33_13>;
  readonly bundleKeys: KeyRegistry;
  readonly trustedOrchestratorSignerIds: readonly string[];
  readonly runtimeKeys: KeyRegistry;
  readonly trustedRuntimeSignerIds: readonly string[];
  readonly capabilityKeys: KeyRegistry;
  readonly trustedCapabilitySignerIds: readonly string[];
  readonly verifierSigner: SigningIdentity;
}): SignedEnvelope<IndependentIsolationVerdictV33_13> {
  const verifiedAtMs = strictIso(input.verifiedAt, 'independent_verdict_time_invalid');
  const bundle = input.bundle.payload;
  const roleIds = [bundle.admissionSignerId, bundle.capabilitySignerId, bundle.challengeSignerId, bundle.runtimeSignerId, bundle.orchestratorSignerId].filter((value): value is string => value !== undefined);
  const verifierIndependent = !roleIds.includes(input.verifierSigner.keyId);
  const bundleSignatureValid = input.trustedOrchestratorSignerIds.includes(input.bundle.issuerKeyId)
    && input.bundleKeys.verifyAt(input.bundle, input.verifiedAt);
  const runtimeValid = verifyQualifiedIsolationReceiptV33_12({
    envelope: input.runtimeReceipt,
    keys: input.runtimeKeys,
    trustedSignerIds: input.trustedRuntimeSignerIds,
  });
  const adapterValid = input.adapterEvidence.issuerKeyId === input.runtimeReceipt.issuerKeyId
    && input.runtimeKeys.verifyAt(input.adapterEvidence, input.adapterEvidence.payload.executedAt)
    && input.adapterEvidence.payload.runtimeReceiptDigest === input.runtimeReceipt.payload.receiptDigest;
  const capabilityValid = verifyHostIsolationCapabilityAttestationV33_13({
    envelope: input.capabilityAttestation,
    keys: input.capabilityKeys,
    trustedSignerIds: input.trustedCapabilitySignerIds,
    at: input.verifiedAt,
  });
  const { bundleDigest, ...bundleMaterial } = bundle;
  const bundleDigestValid = sha256(bundleMaterial) === bundleDigest;
  const bindingsValid = bundle.runtimeReceiptDigest === input.runtimeReceipt.payload.receiptDigest
    && bundle.adapterEvidenceDigest === input.adapterEvidence.payload.evidenceDigest
    && bundle.capabilityAttestationDigest === input.capabilityAttestation.payload.attestationDigest
    && bundle.runtimeSignerId === input.runtimeReceipt.issuerKeyId
    && bundle.orchestratorSignerId === input.bundle.issuerKeyId;
  const unsupportedControlsHonest = !bundle.openat2Qualified && !bundle.seccompQualified && !bundle.cgroupV2Qualified
    && !bundle.secondRuntimeQualified && !bundle.multiHostQualified;
  const passed = verifierIndependent && new Set(roleIds).size === roleIds.length && bundleSignatureValid && runtimeValid
    && adapterValid && capabilityValid && bundleDigestValid && bindingsValid && unsupportedControlsHonest
    && bundle.sourceStable && bundle.separationOfDutiesSatisfied && bundle.productionPromotion === 'blocked'
    && input.runtimeReceipt.payload.externalEffectsExecuted === 0 && input.runtimeReceipt.payload.runtimeRootDestroyed;
  const material = {
    version: '33.13' as const,
    verdictId: required(input.verdictId, 'independent_verdict_id_required'),
    bundleDigest,
    runtimeReceiptDigest: input.runtimeReceipt.payload.receiptDigest,
    status: passed ? 'REFERENCE_QUALIFIED' as const : 'REJECTED' as const,
    promotionCeiling: 'research' as const,
    verifierSignerId: input.verifierSigner.keyId,
    independentFromAdmission: input.verifierSigner.keyId !== bundle.admissionSignerId,
    independentFromChallenge: bundle.challengeSignerId === undefined || input.verifierSigner.keyId !== bundle.challengeSignerId,
    independentFromCapability: input.verifierSigner.keyId !== bundle.capabilitySignerId,
    independentFromRuntime: input.verifierSigner.keyId !== bundle.runtimeSignerId,
    independentFromOrchestrator: input.verifierSigner.keyId !== bundle.orchestratorSignerId,
    unsupportedControls: ['OPENAT2', 'SECCOMP', 'CGROUP_V2', 'SECOND_RUNTIME', 'MULTI_HOST', 'EXTERNAL_WITNESS'] as const,
    productionPromotion: 'blocked' as const,
    externalQualification: 'not_executed' as const,
    verifiedAt: new Date(verifiedAtMs).toISOString(),
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifierSigner);
}

export function verifyIndependentIsolationVerdictV33_13(input: {
  readonly envelope: SignedEnvelope<IndependentIsolationVerdictV33_13>;
  readonly keys: KeyRegistry;
  readonly trustedVerifierSignerIds: readonly string[];
}): boolean {
  const verdict = input.envelope.payload;
  if (!input.trustedVerifierSignerIds.includes(input.envelope.issuerKeyId)
    || input.envelope.issuerKeyId !== verdict.verifierSignerId
    || !input.keys.verifyAt(input.envelope, verdict.verifiedAt)) return false;
  const { verdictDigest, ...material } = verdict;
  return verdict.version === '33.13'
    && verdict.promotionCeiling === 'research'
    && verdict.productionPromotion === 'blocked'
    && verdict.externalQualification === 'not_executed'
    && sha256(material) === verdictDigest;
}

function required(value: string, code: string): string { if (value.trim() === '') throw new Error(code); return value; }
function strictIso(value: string, code: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(code); return parsed; }
