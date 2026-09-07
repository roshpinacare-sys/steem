import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../src/contracts/crypto.js';
import {
  captureDescriptorPinnedRepositoryManifestV33_13,
  probeHostIsolationCapabilitiesV33_13,
  verifyHostIsolationCapabilityAttestationV33_13,
} from '../src/repository/isolation-runtime-contract-v33_13.js';
import {
  createRepositoryAdmissionPolicyV33_11,
  scanRepositoryAdmissionV33_11,
} from '../src/repository/malicious-repository-admission-v33_11.js';
import { createQualifiedHostileCodeIsolationPolicyV33_12 } from '../src/repository/qualified-hostile-code-isolation-v33_12.js';
import {
  createLocalNamespaceRuntimeAdapterV33_13,
  executeOrchestratedHostileCodeV33_13,
  independentlyVerifyIsolationBundleV33_13,
  verifyIndependentIsolationVerdictV33_13,
} from '../src/repository/qualified-hostile-code-orchestrator-v33_13.js';

function registry(identity: ReturnType<typeof generateSigningIdentity>): KeyRegistry {
  const keys = new KeyRegistry();
  keys.register(identity.keyId, identity.publicKey);
  return keys;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'v33-13-repo-'));
  writeFileSync(join(root, 'README.md'), 'v33.13 orchestration fixture\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { safe: '1.0.0' } }, null, 2));
  writeFileSync(join(root, 'entry.sh'), '#!/bin/sh\nset -eu\necho V33_13_OK\n');
  const admissionSigner = generateSigningIdentity('admission-v33.13');
  const capabilitySigner = generateSigningIdentity('capability-v33.13');
  const runtimeSigner = generateSigningIdentity('runtime-v33.13');
  const orchestratorSigner = generateSigningIdentity('orchestrator-v33.13');
  const verifierSigner = generateSigningIdentity('verifier-v33.13');
  const admissionKeys = registry(admissionSigner);
  const capabilityKeys = registry(capabilitySigner);
  const runtimeKeys = registry(runtimeSigner);
  const orchestratorKeys = registry(orchestratorSigner);
  const verifierKeys = registry(verifierSigner);
  const admissionPolicy = createRepositoryAdmissionPolicyV33_11({ policyId: 'admission-v33.13' });
  const now = Date.now();
  const startedAt = new Date(now).toISOString();
  const verifiedAt = new Date(now + 1_000).toISOString();
  const capabilityAttestation = probeHostIsolationCapabilitiesV33_13({
    attestationId: 'host-cap-v33.13',
    generatedAt: new Date(now - 1_000).toISOString(),
    validUntil: new Date(now + 60_000).toISOString(),
    signer: capabilitySigner,
  });
  const admissionEnvelope = scanRepositoryAdmissionV33_11({
    root,
    tenantId: 'tenant-1',
    repositoryId: 'repo-1',
    policy: admissionPolicy,
    signer: admissionSigner,
    generatedAt: startedAt,
  });
  const request = {
    root,
    tenantId: 'tenant-1',
    repositoryId: 'repo-1',
    admissionEnvelope,
    admissionKeys,
    admissionPolicy,
    trustedAdmissionSignerIds: [admissionSigner.keyId],
    policy: createQualifiedHostileCodeIsolationPolicyV33_12({ policyId: 'isolation-v33.13' }),
    entrypointPath: 'entry.sh',
    receiptId: 'receipt-v33.13',
    startedAt,
  } as const;
  const adapter = createLocalNamespaceRuntimeAdapterV33_13({
    adapterId: 'local-namespace-v33.13',
    runtimeSigner,
    capabilityAttestation,
  });
  return {
    root,
    admissionSigner,
    capabilitySigner,
    runtimeSigner,
    orchestratorSigner,
    verifierSigner,
    admissionKeys,
    capabilityKeys,
    runtimeKeys,
    orchestratorKeys,
    verifierKeys,
    capabilityAttestation,
    request,
    adapter,
    verifiedAt,
  };
}

function execute(row: ReturnType<typeof fixture>) {
  return executeOrchestratedHostileCodeV33_13({
    bundleId: 'bundle-v33.13',
    request: row.request,
    adapter: row.adapter,
    capabilityAttestation: row.capabilityAttestation,
    capabilityKeys: row.capabilityKeys,
    trustedCapabilitySignerIds: [row.capabilitySigner.keyId],
    runtimeKeys: row.runtimeKeys,
    trustedRuntimeSignerIds: [row.runtimeSigner.keyId],
    orchestratorSigner: row.orchestratorSigner,
  });
}

function verify(row: ReturnType<typeof fixture>, result: ReturnType<typeof execute>, verifier = row.verifierSigner) {
  return independentlyVerifyIsolationBundleV33_13({
    verdictId: 'verdict-v33.13',
    verifiedAt: row.verifiedAt,
    bundle: result.bundle,
    runtimeReceipt: result.runtimeReceipt,
    adapterEvidence: result.adapterEvidence,
    capabilityAttestation: row.capabilityAttestation,
    bundleKeys: row.orchestratorKeys,
    trustedOrchestratorSignerIds: [row.orchestratorSigner.keyId],
    runtimeKeys: row.runtimeKeys,
    trustedRuntimeSignerIds: [row.runtimeSigner.keyId],
    capabilityKeys: row.capabilityKeys,
    trustedCapabilitySignerIds: [row.capabilitySigner.keyId],
    verifierSigner: verifier,
  });
}

function cleanup(row: ReturnType<typeof fixture>): void { rmSync(row.root, { recursive: true, force: true }); }

test('host capability attestation reports unsupported controls honestly and fails closed', () => {
  const row = fixture();
  try {
    const attestation = row.capabilityAttestation.payload;
    assert.equal(attestation.localNamespaceRuntime, 'VERIFIED_AVAILABLE');
    assert.notEqual(attestation.openat2Snapshot, 'VERIFIED_AVAILABLE');
    assert.notEqual(attestation.seccompFilter, 'VERIFIED_AVAILABLE');
    assert.notEqual(attestation.cgroupV2, 'VERIFIED_AVAILABLE');
    assert.notEqual(attestation.secondRuntimeImplementation, 'VERIFIED_AVAILABLE');
    assert.equal(attestation.productionPromotion, 'blocked');
    assert.equal(verifyHostIsolationCapabilityAttestationV33_13({ envelope: row.capabilityAttestation, keys: row.capabilityKeys, trustedSignerIds: [row.capabilitySigner.keyId], at: row.request.startedAt }), true);
  } finally { cleanup(row); }
});

test('descriptor-pinned manifest is deterministic and rejects symlinks', () => {
  const row = fixture();
  try {
    const first = captureDescriptorPinnedRepositoryManifestV33_13(row.root);
    const second = captureDescriptorPinnedRepositoryManifestV33_13(row.root);
    assert.equal(first.manifestDigest, second.manifestDigest);
    assert.equal(first.openat2Used, false);
    assert.equal(first.raceHardening, 'PARTIAL_REFERENCE_ONLY');
    symlinkSync('/etc/passwd', join(row.root, 'escape-link'));
    assert.throws(() => captureDescriptorPinnedRepositoryManifestV33_13(row.root), /descriptor_snapshot_symlink_rejected/);
  } finally { cleanup(row); }
});

test('orchestrator separates roles and binds adapter evidence to the runtime receipt', () => {
  const row = fixture();
  try {
    const result = execute(row);
    assert.equal(result.bundle.payload.separationOfDutiesSatisfied, true);
    assert.equal(result.bundle.payload.sourceStable, true);
    assert.equal(result.bundle.payload.runtimeReceiptDigest, result.runtimeReceipt.payload.receiptDigest);
    assert.equal(result.bundle.payload.adapterEvidenceDigest, result.adapterEvidence.payload.evidenceDigest);
    assert.equal(result.runtimeReceipt.payload.externalEffectsExecuted, 0);
    assert.equal(result.runtimeReceipt.payload.runtimeRootDestroyed, true);
    assert.match(result.runtimeReceipt.payload.stdoutExcerpt, /V33_13_OK/);
  } finally { cleanup(row); }
});

test('independent verifier qualifies only the local reference and preserves the research ceiling', () => {
  const row = fixture();
  try {
    const result = execute(row);
    const verdict = verify(row, result);
    assert.equal(verdict.payload.status, 'REFERENCE_QUALIFIED');
    assert.equal(verdict.payload.promotionCeiling, 'research');
    assert.equal(verdict.payload.productionPromotion, 'blocked');
    assert.deepEqual(verdict.payload.unsupportedControls, ['OPENAT2', 'SECCOMP', 'CGROUP_V2', 'SECOND_RUNTIME', 'MULTI_HOST', 'EXTERNAL_WITNESS']);
    assert.equal(verifyIndependentIsolationVerdictV33_13({ envelope: verdict, keys: row.verifierKeys, trustedVerifierSignerIds: [row.verifierSigner.keyId] }), true);
  } finally { cleanup(row); }
});

test('verifier cannot be the admission, capability, runtime or orchestrator signer', () => {
  const row = fixture();
  try {
    const result = execute(row);
    for (const signer of [row.admissionSigner, row.capabilitySigner, row.runtimeSigner, row.orchestratorSigner]) {
      const verdict = verify(row, result, signer);
      assert.equal(verdict.payload.status, 'REJECTED');
    }
  } finally { cleanup(row); }
});

test('orchestrator rejects role collision before executing the adapter', () => {
  const row = fixture();
  try {
    assert.throws(() => executeOrchestratedHostileCodeV33_13({
      bundleId: 'collision',
      request: row.request,
      adapter: row.adapter,
      capabilityAttestation: row.capabilityAttestation,
      capabilityKeys: row.capabilityKeys,
      trustedCapabilitySignerIds: [row.capabilitySigner.keyId],
      runtimeKeys: row.runtimeKeys,
      trustedRuntimeSignerIds: [row.runtimeSigner.keyId],
      orchestratorSigner: row.admissionSigner,
    }), /orchestrator_role_separation_invalid/);
  } finally { cleanup(row); }
});

test('tampered capability attestation and expired capability window are rejected', () => {
  const row = fixture();
  try {
    const changed = { ...row.capabilityAttestation, payload: { ...row.capabilityAttestation.payload, cgroupV2: 'VERIFIED_AVAILABLE' as const } };
    assert.throws(() => executeOrchestratedHostileCodeV33_13({
      bundleId: 'tampered', request: row.request, adapter: row.adapter, capabilityAttestation: changed,
      capabilityKeys: row.capabilityKeys, trustedCapabilitySignerIds: [row.capabilitySigner.keyId], runtimeKeys: row.runtimeKeys,
      trustedRuntimeSignerIds: [row.runtimeSigner.keyId], orchestratorSigner: row.orchestratorSigner,
    }), /host_capability_attestation_invalid/);
    assert.equal(verifyHostIsolationCapabilityAttestationV33_13({ envelope: row.capabilityAttestation, keys: row.capabilityKeys, trustedSignerIds: [row.capabilitySigner.keyId], at: new Date(Date.parse(row.capabilityAttestation.payload.validUntil) + 1).toISOString() }), false);
  } finally { cleanup(row); }
});

test('orchestrator rejects an untrusted runtime signer even when the adapter returns valid-looking data', () => {
  const row = fixture();
  try {
    const wrongRuntime = generateSigningIdentity('wrong-runtime');
    const wrongAdapter = createLocalNamespaceRuntimeAdapterV33_13({ adapterId: 'wrong-adapter', runtimeSigner: wrongRuntime, capabilityAttestation: row.capabilityAttestation });
    assert.throws(() => executeOrchestratedHostileCodeV33_13({
      bundleId: 'wrong-runtime', request: row.request, adapter: wrongAdapter, capabilityAttestation: row.capabilityAttestation,
      capabilityKeys: row.capabilityKeys, trustedCapabilitySignerIds: [row.capabilitySigner.keyId], runtimeKeys: row.runtimeKeys,
      trustedRuntimeSignerIds: [row.runtimeSigner.keyId], orchestratorSigner: row.orchestratorSigner,
    }), /runtime_adapter_signature_invalid/);
  } finally { cleanup(row); }
});

test('independent verifier rejects tampered bundle bindings', () => {
  const row = fixture();
  try {
    const result = execute(row);
    const tamperedPayload = { ...result.bundle.payload, runtimeReceiptDigest: '0'.repeat(64) };
    const tampered = { ...result.bundle, payload: tamperedPayload };
    const verdict = independentlyVerifyIsolationBundleV33_13({
      verdictId: 'tampered-verdict', verifiedAt: row.verifiedAt, bundle: tampered, runtimeReceipt: result.runtimeReceipt,
      adapterEvidence: result.adapterEvidence, capabilityAttestation: row.capabilityAttestation, bundleKeys: row.orchestratorKeys,
      trustedOrchestratorSignerIds: [row.orchestratorSigner.keyId], runtimeKeys: row.runtimeKeys,
      trustedRuntimeSignerIds: [row.runtimeSigner.keyId], capabilityKeys: row.capabilityKeys,
      trustedCapabilitySignerIds: [row.capabilitySigner.keyId], verifierSigner: row.verifierSigner,
    });
    assert.equal(verdict.payload.status, 'REJECTED');
  } finally { cleanup(row); }
});

test('verdict tampering and untrusted verifier fail verification', () => {
  const row = fixture();
  try {
    const result = execute(row);
    const verdict = verify(row, result);
    const changed = { ...verdict, payload: { ...verdict.payload, promotionCeiling: 'production' as never } };
    assert.equal(verifyIndependentIsolationVerdictV33_13({ envelope: changed, keys: row.verifierKeys, trustedVerifierSignerIds: [row.verifierSigner.keyId] }), false);
    assert.equal(verifyIndependentIsolationVerdictV33_13({ envelope: verdict, keys: row.verifierKeys, trustedVerifierSignerIds: ['other'] }), false);
  } finally { cleanup(row); }
});

test('repository content change changes the descriptor manifest digest', () => {
  const row = fixture();
  try {
    const before = captureDescriptorPinnedRepositoryManifestV33_13(row.root);
    writeFileSync(join(row.root, 'README.md'), readFileSync(join(row.root, 'README.md'), 'utf8') + 'changed\n');
    const after = captureDescriptorPinnedRepositoryManifestV33_13(row.root);
    assert.notEqual(before.manifestDigest, after.manifestDigest);
  } finally { cleanup(row); }
});

test('synthetic attestation cannot claim production by recomputing only its digest', () => {
  const row = fixture();
  try {
    const { attestationDigest: _discard, ...material } = row.capabilityAttestation.payload;
    const falseMaterial = { ...material, productionPromotion: 'allowed' as never };
    const forged = signEnvelope({ ...falseMaterial, attestationDigest: sha256(falseMaterial) }, row.capabilitySigner);
    assert.equal(verifyHostIsolationCapabilityAttestationV33_13({ envelope: forged as never, keys: row.capabilityKeys, trustedSignerIds: [row.capabilitySigner.keyId], at: row.request.startedAt }), false);
  } finally { cleanup(row); }
});
