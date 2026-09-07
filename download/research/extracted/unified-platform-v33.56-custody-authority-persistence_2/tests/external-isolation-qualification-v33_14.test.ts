import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../src/contracts/crypto.js';
import {
  createExternalIsolationObservationV33_14,
  createExternalIsolationQualificationChallengeV33_14,
  evaluateExternalIsolationQualificationV33_14,
  executeHostControlAttestationV33_14,
  qualifyPortableSecondRuntimeV33_14,
  verifyExecutedHostControlAttestationV33_14,
  verifyExternalIsolationQualificationVerdictV33_14,
  verifyPortableSecondRuntimeEvidenceV33_14,
} from '../src/isolation/external-isolation-qualification-v33_14.js';

const here = dirname(fileURLToPath(import.meta.url));
const wasm = readFileSync(join(here, '..', '..', 'isolation', 'wasm-core', 'artifacts', 'allowed.wasm'));
const now = Date.now();
const issuedAt = new Date(now).toISOString();
const validUntil = new Date(now + 600_000).toISOString();

function registry(...identities: ReturnType<typeof generateSigningIdentity>[]): KeyRegistry {
  const keys = new KeyRegistry();
  for (const identity of identities) keys.register(identity.keyId, identity.publicKey);
  return keys;
}

function challengeFixture() {
  const authority = generateSigningIdentity('v33.14-authority');
  const verifier = generateSigningIdentity('v33.14-verifier');
  const challenge = createExternalIsolationQualificationChallengeV33_14({ challengeId: 'challenge-1', issuedAt, validUntil, corpusDigest: sha256('corpus'), signer: authority });
  return { authority, verifier, challenge, challengeKeys: registry(authority), verifierKeys: registry(verifier) };
}

test('executed host control attestation is signed, time bounded and honest', () => {
  const signer = generateSigningIdentity('control-probe');
  const keys = registry(signer);
  const envelope = executeHostControlAttestationV33_14({ attestationId: 'att-1', generatedAt: issuedAt, validUntil, signer });
  assert.equal(verifyExecutedHostControlAttestationV33_14({ envelope, keys, trustedSignerIds: [signer.keyId], at: issuedAt }), true);
  assert.equal(envelope.payload.productionPromotion, 'blocked');
  assert.ok(['VERIFIED_AVAILABLE', 'VERIFIED_UNAVAILABLE', 'PROBE_FAILED'].includes(envelope.payload.openat2.state));
  assert.ok(['VERIFIED_AVAILABLE', 'VERIFIED_UNAVAILABLE', 'PROBE_FAILED'].includes(envelope.payload.seccompStrict.state));
  assert.ok(['VERIFIED_AVAILABLE', 'VERIFIED_UNAVAILABLE', 'PROBE_FAILED'].includes(envelope.payload.cgroupV2.state));
  assert.notEqual(envelope.payload.openat2.detail, '');
  assert.notEqual(envelope.payload.seccompStrict.detail, '');
});

test('tampering with executed control state invalidates attestation', () => {
  const signer = generateSigningIdentity('control-tamper');
  const keys = registry(signer);
  const envelope = executeHostControlAttestationV33_14({ attestationId: 'att-2', generatedAt: issuedAt, validUntil, signer });
  const changedState = envelope.payload.openat2.state === 'VERIFIED_AVAILABLE' ? 'VERIFIED_UNAVAILABLE' as const : 'VERIFIED_AVAILABLE' as const;
  const changed = { ...envelope, payload: { ...envelope.payload, openat2: { ...envelope.payload.openat2, state: changedState } } };
  assert.equal(verifyExecutedHostControlAttestationV33_14({ envelope: changed, keys, trustedSignerIds: [signer.keyId], at: issuedAt }), false);
});

test('portable WASM challenge qualifies only a specialized second runtime', async () => {
  const signer = generateSigningIdentity('wasm-runtime');
  const keys = registry(signer);
  const evidence = await qualifyPortableSecondRuntimeV33_14({
    evidenceId: 'wasm-1', generatedAt: issuedAt, bytes: wasm, challengeInput: [3, 5, 7], signer,
    policy: { policyDigest: sha256('v33.14-wasm-policy'), maximumModuleBytes: 1024 * 1024, maximumMemoryBytes: 131072, maximumExecutionMs: 500, requiredRunExport: 'run', requiredMemoryExport: 'memory', allowedImports: ['cap.emit', 'cap.read_byte'] },
  });
  assert.equal(evidence.payload.state, 'SPECIALIZED_REFERENCE_QUALIFIED');
  assert.equal(evidence.payload.output, 15);
  assert.equal(evidence.payload.generalRepositoryRuntimeQualified, false);
  assert.equal(verifyPortableSecondRuntimeEvidenceV33_14({ envelope: evidence, keys, trustedSignerIds: [signer.keyId] }), true);
});

test('external qualification with no observations remains required', () => {
  const row = challengeFixture();
  const verdict = evaluateExternalIsolationQualificationV33_14({ verdictId: 'verdict-empty', evaluatedAt: issuedAt, challenge: row.challenge, challengeKeys: row.challengeKeys, trustedChallengeSignerIds: [row.authority.keyId], observations: [], observationKeys: new KeyRegistry(), trustedObservationSignerIds: [], signer: row.verifier });
  assert.equal(verdict.payload.status, 'EXTERNAL_QUALIFICATION_REQUIRED');
  assert.equal(verdict.payload.promotionCeiling, 'research');
  assert.equal(verdict.payload.productionPromotion, 'blocked');
  assert.ok(verdict.payload.blockers.includes('TWO_DISTINCT_HOSTS_REQUIRED'));
  assert.equal(verifyExternalIsolationQualificationVerdictV33_14({ envelope: verdict, keys: row.verifierKeys, trustedSignerIds: [row.verifier.keyId] }), true);
});

test('synthetic observations never qualify the external gate', () => {
  const row = challengeFixture();
  const op1 = generateSigningIdentity('operator-1'); const exec1 = generateSigningIdentity('execution-1');
  const op2 = generateSigningIdentity('operator-2'); const exec2 = generateSigningIdentity('execution-2');
  const observations = [
    createExternalIsolationObservationV33_14({ observationId: 'obs-1', challenge: row.challenge, observedAt: issuedAt, hostId: 'host-a', organizationId: 'org-a', runtimeImplementation: 'runtime-a', executionSignerId: exec1.keyId, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', controls: { openat2: true, seccomp: true, cgroupV2: true, networkIsolation: true, filesystemIsolation: true, destruction: true }, evidenceBundleDigest: sha256('bundle-a'), signer: op1 }),
    createExternalIsolationObservationV33_14({ observationId: 'obs-2', challenge: row.challenge, observedAt: issuedAt, hostId: 'host-b', organizationId: 'org-b', runtimeImplementation: 'runtime-b', executionSignerId: exec2.keyId, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', controls: { openat2: true, seccomp: true, cgroupV2: true, networkIsolation: true, filesystemIsolation: true, destruction: true }, evidenceBundleDigest: sha256('bundle-b'), signer: op2 }),
  ];
  const observationKeys = registry(op1, op2);
  const verdict = evaluateExternalIsolationQualificationV33_14({ verdictId: 'verdict-synthetic', evaluatedAt: issuedAt, challenge: row.challenge, challengeKeys: row.challengeKeys, trustedChallengeSignerIds: [row.authority.keyId], observations, observationKeys, trustedObservationSignerIds: [op1.keyId, op2.keyId], signer: row.verifier });
  assert.equal(verdict.payload.status, 'EXTERNAL_QUALIFICATION_REQUIRED');
  assert.equal(verdict.payload.acceptedObservationCount, 0);
  assert.equal(verdict.payload.syntheticObservationCount, 2);
  assert.ok(verdict.payload.blockers.includes('SYNTHETIC_OBSERVATIONS_DO_NOT_QUALIFY_EXTERNAL_GATE'));
});

test('self-observation by execution signer is rejected', () => {
  const row = challengeFixture();
  const operator = generateSigningIdentity('self-operator');
  const observation = createExternalIsolationObservationV33_14({ observationId: 'obs-self', challenge: row.challenge, observedAt: issuedAt, hostId: 'host-a', organizationId: 'org-a', runtimeImplementation: 'runtime-a', executionSignerId: operator.keyId, evidenceClass: 'EXTERNAL_OBSERVED', controls: { openat2: true, seccomp: true, cgroupV2: true, networkIsolation: true, filesystemIsolation: true, destruction: true }, evidenceBundleDigest: sha256('bundle-self'), signer: operator });
  const verdict = evaluateExternalIsolationQualificationV33_14({ verdictId: 'verdict-self', evaluatedAt: issuedAt, challenge: row.challenge, challengeKeys: row.challengeKeys, trustedChallengeSignerIds: [row.authority.keyId], observations: [observation], observationKeys: registry(operator), trustedObservationSignerIds: [operator.keyId], signer: row.verifier });
  assert.equal(verdict.payload.status, 'EXTERNAL_QUALIFICATION_REQUIRED');
  assert.ok(verdict.payload.blockers.includes('OBSERVATION_INVALID:obs-self'));
});

test('incomplete control evidence cannot qualify', () => {
  const row = challengeFixture();
  const operator = generateSigningIdentity('partial-operator'); const execution = generateSigningIdentity('partial-execution');
  const observation = createExternalIsolationObservationV33_14({ observationId: 'obs-partial', challenge: row.challenge, observedAt: issuedAt, hostId: 'host-a', organizationId: 'org-a', runtimeImplementation: 'runtime-a', executionSignerId: execution.keyId, evidenceClass: 'EXTERNAL_OBSERVED', controls: { openat2: false, seccomp: true, cgroupV2: true, networkIsolation: true, filesystemIsolation: true, destruction: true }, evidenceBundleDigest: sha256('bundle-partial'), signer: operator });
  const verdict = evaluateExternalIsolationQualificationV33_14({ verdictId: 'verdict-partial', evaluatedAt: issuedAt, challenge: row.challenge, challengeKeys: row.challengeKeys, trustedChallengeSignerIds: [row.authority.keyId], observations: [observation], observationKeys: registry(operator), trustedObservationSignerIds: [operator.keyId], signer: row.verifier });
  assert.equal(verdict.payload.acceptedObservationCount, 0);
  assert.ok(verdict.payload.blockers.includes('OBSERVATION_CONTROL_INCOMPLETE:obs-partial'));
});

test('expired challenge is rejected', () => {
  const row = challengeFixture();
  const after = new Date(Date.parse(validUntil) + 1).toISOString();
  const verdict = evaluateExternalIsolationQualificationV33_14({ verdictId: 'verdict-expired', evaluatedAt: after, challenge: row.challenge, challengeKeys: row.challengeKeys, trustedChallengeSignerIds: [row.authority.keyId], observations: [], observationKeys: new KeyRegistry(), trustedObservationSignerIds: [], signer: row.verifier });
  assert.equal(verdict.payload.status, 'REJECTED');
  assert.ok(verdict.payload.blockers.includes('CHALLENGE_INVALID_OR_EXPIRED'));
});

test('tampered verdict fails signature verification', () => {
  const row = challengeFixture();
  const verdict = evaluateExternalIsolationQualificationV33_14({ verdictId: 'verdict-tamper', evaluatedAt: issuedAt, challenge: row.challenge, challengeKeys: row.challengeKeys, trustedChallengeSignerIds: [row.authority.keyId], observations: [], observationKeys: new KeyRegistry(), trustedObservationSignerIds: [], signer: row.verifier });
  const changed = { ...verdict, payload: { ...verdict.payload, status: 'EXTERNAL_QUALIFIED' as const } };
  assert.equal(verifyExternalIsolationQualificationVerdictV33_14({ envelope: changed, keys: row.verifierKeys, trustedSignerIds: [row.verifier.keyId] }), false);
});

test('challenge corpus digest must be a real SHA-256 digest', () => {
  const authority = generateSigningIdentity('bad-corpus');
  assert.throws(() => createExternalIsolationQualificationChallengeV33_14({ challengeId: 'bad', issuedAt, validUntil, corpusDigest: 'not-a-digest', signer: authority }), /external_challenge_corpus_digest_invalid/);
});

test('recomputed inner digest without a valid signature does not verify', () => {
  const signer = generateSigningIdentity('inner-digest');
  const keys = registry(signer);
  const envelope = executeHostControlAttestationV33_14({ attestationId: 'att-inner', generatedAt: issuedAt, validUntil, signer });
  const payload = { ...envelope.payload, limitations: [] as string[] };
  const { attestationDigest: _old, ...material } = payload;
  const forged = { ...envelope, payload: { ...payload, attestationDigest: sha256(material) } };
  assert.equal(verifyExecutedHostControlAttestationV33_14({ envelope: forged, keys, trustedSignerIds: [signer.keyId], at: issuedAt }), false);
});

test('synthetic observation cannot be relabeled without invalidating signature', () => {
  const row = challengeFixture();
  const operator = generateSigningIdentity('relabel-operator'); const execution = generateSigningIdentity('relabel-execution');
  const observation = createExternalIsolationObservationV33_14({ observationId: 'obs-relabel', challenge: row.challenge, observedAt: issuedAt, hostId: 'host-a', organizationId: 'org-a', runtimeImplementation: 'runtime-a', executionSignerId: execution.keyId, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', controls: { openat2: true, seccomp: true, cgroupV2: true, networkIsolation: true, filesystemIsolation: true, destruction: true }, evidenceBundleDigest: sha256('bundle-relabel'), signer: operator });
  const changed = { ...observation, payload: { ...observation.payload, evidenceClass: 'EXTERNAL_OBSERVED' as const } };
  const verdict = evaluateExternalIsolationQualificationV33_14({ verdictId: 'verdict-relabel', evaluatedAt: issuedAt, challenge: row.challenge, challengeKeys: row.challengeKeys, trustedChallengeSignerIds: [row.authority.keyId], observations: [changed], observationKeys: registry(operator), trustedObservationSignerIds: [operator.keyId], signer: row.verifier });
  assert.ok(verdict.payload.blockers.includes('OBSERVATION_INVALID:obs-relabel'));
});
