import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyRegistry, generateSigningIdentity, sha256 } from '../dist/src/contracts/crypto.js';
import {
  createExternalIsolationObservationV33_14,
  createExternalIsolationQualificationChallengeV33_14,
  evaluateExternalIsolationQualificationV33_14,
  executeHostControlAttestationV33_14,
  qualifyPortableSecondRuntimeV33_14,
  verifyExecutedHostControlAttestationV33_14,
  verifyExternalIsolationQualificationVerdictV33_14,
  verifyPortableSecondRuntimeEvidenceV33_14,
} from '../dist/src/isolation/external-isolation-qualification-v33_14.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(root, 'release-evidence/v33.14');
mkdirSync(out, { recursive: true });
const roleNames = ['control', 'wasm', 'authority', 'operatorA', 'operatorB', 'executionA', 'executionB', 'verifier'];
const identities = Object.fromEntries(roleNames.map((name) => [name, generateSigningIdentity(`v33.14-${name}`)]));
const keys = new KeyRegistry();
for (const identity of Object.values(identities)) keys.register(identity.keyId, identity.publicKey);
const generatedAt = '2026-07-21T18:00:00.000Z';
const validUntil = '2026-07-21T19:00:00.000Z';
const evaluatedAt = '2026-07-21T18:10:00.000Z';
const controlAttestation = executeHostControlAttestationV33_14({ attestationId: 'v33.14-local-host-controls', generatedAt, validUntil, signer: identities.control });
const wasm = readFileSync(resolve(root, 'isolation/wasm-core/artifacts/allowed.wasm'));
const secondRuntimeEvidence = await qualifyPortableSecondRuntimeV33_14({
  evidenceId: 'v33.14-portable-wasm-runtime', generatedAt, bytes: wasm, challengeInput: [3, 5, 7], signer: identities.wasm,
  policy: { policyDigest: sha256('v33.14-wasm-policy'), maximumModuleBytes: 1024 * 1024, maximumMemoryBytes: 131072, maximumExecutionMs: 500, requiredRunExport: 'run', requiredMemoryExport: 'memory', allowedImports: ['cap.emit', 'cap.read_byte'] },
});
const challenge = createExternalIsolationQualificationChallengeV33_14({ challengeId: 'v33.14-external-isolation-challenge', issuedAt: generatedAt, validUntil, corpusDigest: sha256('v33.14-external-isolation-corpus'), signer: identities.authority });
const emptyVerdict = evaluateExternalIsolationQualificationV33_14({ verdictId: 'v33.14-empty-external-verdict', evaluatedAt, challenge, challengeKeys: keys, trustedChallengeSignerIds: [identities.authority.keyId], observations: [], observationKeys: keys, trustedObservationSignerIds: [identities.operatorA.keyId, identities.operatorB.keyId], signer: identities.verifier });
const syntheticObservations = [
  createExternalIsolationObservationV33_14({ observationId: 'synthetic-a', challenge, observedAt: evaluatedAt, hostId: 'synthetic-host-a', organizationId: 'synthetic-org-a', runtimeImplementation: 'synthetic-runtime-a', executionSignerId: identities.executionA.keyId, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', controls: { openat2: true, seccomp: true, cgroupV2: true, networkIsolation: true, filesystemIsolation: true, destruction: true }, evidenceBundleDigest: sha256('synthetic-bundle-a'), signer: identities.operatorA }),
  createExternalIsolationObservationV33_14({ observationId: 'synthetic-b', challenge, observedAt: evaluatedAt, hostId: 'synthetic-host-b', organizationId: 'synthetic-org-b', runtimeImplementation: 'synthetic-runtime-b', executionSignerId: identities.executionB.keyId, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', controls: { openat2: true, seccomp: true, cgroupV2: true, networkIsolation: true, filesystemIsolation: true, destruction: true }, evidenceBundleDigest: sha256('synthetic-bundle-b'), signer: identities.operatorB }),
];
const syntheticVerdict = evaluateExternalIsolationQualificationV33_14({ verdictId: 'v33.14-synthetic-external-verdict', evaluatedAt, challenge, challengeKeys: keys, trustedChallengeSignerIds: [identities.authority.keyId], observations: syntheticObservations, observationKeys: keys, trustedObservationSignerIds: [identities.operatorA.keyId, identities.operatorB.keyId], signer: identities.verifier });
const proofMaterial = {
  version: '33.14',
  status: 'EXECUTED_LOCAL_PROBES_AND_EXTERNAL_KIT_READY',
  evidenceClass: 'LOCAL_EXECUTED_CONTROLS_AND_SYNTHETIC_CONTRACT_TEST',
  controlAttestationVerified: verifyExecutedHostControlAttestationV33_14({ envelope: controlAttestation, keys, trustedSignerIds: [identities.control.keyId], at: evaluatedAt }),
  openat2State: controlAttestation.payload.openat2.state,
  seccompState: controlAttestation.payload.seccompStrict.state,
  cgroupV2State: controlAttestation.payload.cgroupV2.state,
  secondRuntimeEvidenceVerified: verifyPortableSecondRuntimeEvidenceV33_14({ envelope: secondRuntimeEvidence, keys, trustedSignerIds: [identities.wasm.keyId] }),
  secondRuntimeState: secondRuntimeEvidence.payload.state,
  secondRuntimeScope: secondRuntimeEvidence.payload.scope,
  generalRepositorySecondRuntimeQualified: secondRuntimeEvidence.payload.generalRepositoryRuntimeQualified,
  emptyExternalVerdictVerified: verifyExternalIsolationQualificationVerdictV33_14({ envelope: emptyVerdict, keys, trustedSignerIds: [identities.verifier.keyId] }),
  emptyExternalVerdictStatus: emptyVerdict.payload.status,
  syntheticExternalVerdictVerified: verifyExternalIsolationQualificationVerdictV33_14({ envelope: syntheticVerdict, keys, trustedSignerIds: [identities.verifier.keyId] }),
  syntheticExternalVerdictStatus: syntheticVerdict.payload.status,
  syntheticObservationsExcluded: syntheticVerdict.payload.acceptedObservationCount === 0 && syntheticVerdict.payload.syntheticObservationCount === 2,
  requiredDistinctHosts: challenge.payload.requiredDistinctHosts,
  requiredDistinctOrganizations: challenge.payload.requiredDistinctOrganizations,
  requiredDistinctRuntimeImplementations: challenge.payload.requiredDistinctRuntimeImplementations,
  externalObservedEvidenceCount: 0,
  externalQualification: 'not_executed',
  promotionCeiling: 'research',
  productionPromotion: 'blocked',
  limitations: [
    'OPENAT2_EXECUTED_PROBE_NOT_AVAILABLE_ON_CURRENT_KERNEL',
    'SECCOMP_EXECUTED_PROBE_NOT_AVAILABLE_ON_CURRENT_HOST',
    'CGROUP_V2_DELEGATION_NOT_AVAILABLE',
    'WASM_SECOND_RUNTIME_IS_SPECIALIZED_NOT_GENERAL_REPOSITORY_RUNTIME',
    'NO_SECOND_EXTERNAL_HOST',
    'NO_EXTERNAL_INDEPENDENT_WITNESS',
    'SYNTHETIC_CONTRACT_TESTS_DO_NOT_QUALIFY_EXTERNAL_GATE',
  ],
};
const proof = { ...proofMaterial, proofDigest: sha256(proofMaterial) };
const trace = { version: '33.14', roleKeyIds: Object.fromEntries(Object.entries(identities).map(([name, identity]) => [name, identity.keyId])), controlAttestation, secondRuntimeEvidence, challenge, syntheticObservations, emptyVerdict, syntheticVerdict };
writeFileSync(join(out, 'V33_14_EXTERNAL_ISOLATION_QUALIFICATION_PROOF.json'), JSON.stringify(proof, null, 2) + '\n');
writeFileSync(join(out, 'V33_14_EXTERNAL_QUALIFICATION_TRACE.json'), JSON.stringify(trace, null, 2) + '\n');
writeFileSync(join(out, 'V33_14_EXTERNAL_QUALIFICATION_CHALLENGE.json'), JSON.stringify(challenge, null, 2) + '\n');
console.log(JSON.stringify(proof, null, 2));
