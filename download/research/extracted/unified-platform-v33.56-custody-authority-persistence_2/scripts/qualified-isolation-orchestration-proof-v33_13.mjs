import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256 } from '../dist/src/contracts/crypto.js';
import { probeHostIsolationCapabilitiesV33_13 } from '../dist/src/isolation/isolation-runtime-contract-v33_13.js';
import { createRepositoryAdmissionPolicyV33_11, scanRepositoryAdmissionV33_11 } from '../dist/src/repository/malicious-repository-admission-v33_11.js';
import { createQualifiedHostileCodeIsolationPolicyV33_12 } from '../dist/src/repository/qualified-hostile-code-isolation-v33_12.js';
import {
  createLocalNamespaceRuntimeAdapterV33_13,
  executeOrchestratedHostileCodeV33_13,
  independentlyVerifyIsolationBundleV33_13,
  verifyIndependentIsolationVerdictV33_13,
} from '../dist/src/repository/qualified-hostile-code-orchestrator-v33_13.js';

const outputDir = resolve('release-evidence/v33.13');
mkdirSync(outputDir, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'v33-13-proof-'));
const identities = Object.fromEntries(['admission','capability','runtime','orchestrator','verifier'].map((role) => [role, generateSigningIdentity(`${role}-v33.13-proof`)]));
const keys = Object.fromEntries(Object.entries(identities).map(([role, identity]) => { const registry = new KeyRegistry(); registry.register(identity.keyId, identity.publicKey); return [role, registry]; }));
const now = Date.now();
const startedAt = new Date(now).toISOString();
const verifiedAt = new Date(now + 1000).toISOString();
try {
  writeFileSync(join(root, 'README.md'), 'V33.13 proof fixture\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'v33-13-proof', version: '1.0.0', dependencies: { safe: '1.0.0' } }, null, 2));
  writeFileSync(join(root, 'entry.sh'), '#!/bin/sh\nset -eu\necho V33_13_PROOF_OK\n');
  const admissionPolicy = createRepositoryAdmissionPolicyV33_11({ policyId: 'v33.13-proof-admission' });
  const admissionEnvelope = scanRepositoryAdmissionV33_11({ root, tenantId: 'tenant-proof', repositoryId: 'repo-proof', policy: admissionPolicy, signer: identities.admission, generatedAt: startedAt });
  const capabilityAttestation = probeHostIsolationCapabilitiesV33_13({ attestationId: 'host-proof', generatedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 60000).toISOString(), signer: identities.capability });
  const request = {
    root, tenantId: 'tenant-proof', repositoryId: 'repo-proof', admissionEnvelope, admissionKeys: keys.admission,
    admissionPolicy, trustedAdmissionSignerIds: [identities.admission.keyId],
    policy: createQualifiedHostileCodeIsolationPolicyV33_12({ policyId: 'v33.13-proof-runtime' }),
    entrypointPath: 'entry.sh', receiptId: 'receipt-v33.13-proof', startedAt,
  };
  const adapter = createLocalNamespaceRuntimeAdapterV33_13({ adapterId: 'local-reference', runtimeSigner: identities.runtime, capabilityAttestation });
  const result = executeOrchestratedHostileCodeV33_13({
    bundleId: 'bundle-v33.13-proof', request, adapter, capabilityAttestation, capabilityKeys: keys.capability,
    trustedCapabilitySignerIds: [identities.capability.keyId], runtimeKeys: keys.runtime,
    trustedRuntimeSignerIds: [identities.runtime.keyId], orchestratorSigner: identities.orchestrator,
  });
  const verdict = independentlyVerifyIsolationBundleV33_13({
    verdictId: 'verdict-v33.13-proof', verifiedAt, bundle: result.bundle, runtimeReceipt: result.runtimeReceipt,
    adapterEvidence: result.adapterEvidence, capabilityAttestation, bundleKeys: keys.orchestrator,
    trustedOrchestratorSignerIds: [identities.orchestrator.keyId], runtimeKeys: keys.runtime,
    trustedRuntimeSignerIds: [identities.runtime.keyId], capabilityKeys: keys.capability,
    trustedCapabilitySignerIds: [identities.capability.keyId], verifierSigner: identities.verifier,
  });
  const selfVerdict = independentlyVerifyIsolationBundleV33_13({
    verdictId: 'self-verdict-v33.13-proof', verifiedAt, bundle: result.bundle, runtimeReceipt: result.runtimeReceipt,
    adapterEvidence: result.adapterEvidence, capabilityAttestation, bundleKeys: keys.orchestrator,
    trustedOrchestratorSignerIds: [identities.orchestrator.keyId], runtimeKeys: keys.runtime,
    trustedRuntimeSignerIds: [identities.runtime.keyId], capabilityKeys: keys.capability,
    trustedCapabilitySignerIds: [identities.capability.keyId], verifierSigner: identities.runtime,
  });
  const proofMaterial = {
    version: '33.13',
    status: 'LOCAL_MULTI_ROLE_REFERENCE_QUALIFICATION_PASSED',
    evidenceClass: 'LOCAL_REFERENCE_MULTI_ROLE_QUALIFICATION',
    capabilityAttestationVerified: keys.capability.verifyAt(capabilityAttestation, startedAt),
    localNamespaceRuntime: capabilityAttestation.payload.localNamespaceRuntime,
    openat2Qualified: result.bundle.payload.openat2Qualified,
    seccompQualified: result.bundle.payload.seccompQualified,
    cgroupV2Qualified: result.bundle.payload.cgroupV2Qualified,
    secondRuntimeQualified: result.bundle.payload.secondRuntimeQualified,
    multiHostQualified: result.bundle.payload.multiHostQualified,
    sourceStable: result.bundle.payload.sourceStable,
    descriptorManifestStable: result.snapshotBefore.manifestDigest === result.snapshotAfter.manifestDigest,
    runtimeReceiptVerified: keys.runtime.verifyAt(result.runtimeReceipt, result.runtimeReceipt.payload.completedAt),
    adapterEvidenceVerified: keys.runtime.verifyAt(result.adapterEvidence, result.adapterEvidence.payload.executedAt),
    independentVerdictVerified: verifyIndependentIsolationVerdictV33_13({ envelope: verdict, keys: keys.verifier, trustedVerifierSignerIds: [identities.verifier.keyId] }),
    independentVerdictStatus: verdict.payload.status,
    selfVerificationRejected: selfVerdict.payload.status === 'REJECTED',
    roleCount: new Set([identities.admission.keyId, identities.capability.keyId, identities.runtime.keyId, identities.orchestrator.keyId, identities.verifier.keyId]).size,
    externalEffectsExecuted: result.runtimeReceipt.payload.externalEffectsExecuted,
    runtimeRootDestroyed: result.runtimeReceipt.payload.runtimeRootDestroyed,
    promotionCeiling: verdict.payload.promotionCeiling,
    productionPromotion: 'blocked',
    externalQualification: 'not_executed',
    limitations: result.bundle.payload.limitations,
    bundleDigest: result.bundle.payload.bundleDigest,
    verdictDigest: verdict.payload.verdictDigest,
  };
  const proof = { ...proofMaterial, proofDigest: sha256(proofMaterial) };
  const trace = {
    version: '33.13',
    roleKeyIds: Object.fromEntries(Object.entries(identities).map(([role, identity]) => [role, identity.keyId])),
    capabilityAttestation,
    snapshotBefore: result.snapshotBefore,
    snapshotAfter: result.snapshotAfter,
    runtimeReceipt: result.runtimeReceipt,
    adapterEvidence: result.adapterEvidence,
    bundle: result.bundle,
    verdict,
    selfVerdict,
  };
  writeFileSync(join(outputDir, 'V33_13_QUALIFIED_ISOLATION_ORCHESTRATION_PROOF.json'), JSON.stringify(proof, null, 2) + '\n');
  writeFileSync(join(outputDir, 'V33_13_MULTI_ROLE_TRACE.json'), JSON.stringify(trace, null, 2) + '\n');
  console.log(JSON.stringify(proof, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
