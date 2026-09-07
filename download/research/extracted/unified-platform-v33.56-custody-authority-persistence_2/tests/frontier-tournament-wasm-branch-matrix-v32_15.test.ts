import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createBlindTournamentAssignmentV32_15,
  evaluateBlindedFrontierTournamentV32_15,
  type TournamentJudgeV32_15,
  type TournamentRunSpecV32_15,
  type TournamentScoreV32_15,
  type TournamentSubmissionV32_15,
  type TournamentTrustPolicyV32_15,
} from '../src/benchmark/blinded-frontier-tournament-v32_15.js';
import { generateSigningIdentity, KeyRegistry, sha256, sha256Bytes, signEnvelope, type SigningIdentity } from '../src/contracts/crypto.js';
import {
  evaluateWasmComponentAdmissionV32_15,
  evaluateWasmComponentCompositionV32_15,
  type ProofCarryingWasmComponentManifestV32_15,
  type WasmComponentPolicyV32_15,
} from '../src/isolation/proof-carrying-wasm-component-v32_15.js';
import {
  evaluateMultiHostChallengeV32_15,
  issueMultiHostChallengeV32_15,
  signMultiHostObservationV32_15,
  type MultiHostChallengeV32_15,
  type MultiHostObservationV32_15,
  type MultiHostTrustPolicyV32_15,
} from '../src/qualification/multi-host-challenge-v32_15.js';

const digest = (value: string) => sha256(value);
const now = new Date('2026-07-20T11:00:00.000Z');

function tournamentFixture(taskCount = 3) {
  const providerKeys = [generateSigningIdentity('bm-provider-a'), generateSigningIdentity('bm-provider-b')];
  const judgeKeys = [generateSigningIdentity('bm-judge-a'), generateSigningIdentity('bm-judge-b')];
  const registry = new KeyRegistry();
  [...providerKeys, ...judgeKeys].forEach((identity) => registry.register(identity.keyId, identity.publicKey));
  const spec: TournamentRunSpecV32_15 = {
    schemaVersion: '32.15', runId: 'bm-run', sourceDigest: digest('source'), corpusDigest: digest('corpus'), policyDigest: digest('policy'), blindSaltDigest: digest('salt'), evidenceClass: 'SYNTHETIC',
    entries: [
      { entryId: 'a', providerId: 'provider-a', modelId: 'model-a', modelVersion: '1', collectorId: 'collector-a', organizationId: 'org-a', evidenceClass: 'SYNTHETIC', costMicros: 1 },
      { entryId: 'b', providerId: 'provider-b', modelId: 'model-b', modelVersion: '1', collectorId: 'collector-b', organizationId: 'org-b', evidenceClass: 'SYNTHETIC', costMicros: 1 },
    ],
    tasks: Array.from({ length: taskCount }, (_, index) => ({ taskId: `task-${index}`, promptDigest: digest(`p${index}`), artifactDigest: digest(`a${index}`), dimensions: [{ dimensionId: 'correctness', weight: 1, maximumScore: 10 }], hiddenGoldChecks: ['gold'] })),
    minimumIndependentJudges: 2, minimumTasks: taskCount, minimumProviders: 2, maximumCostMicros: 10_000,
  };
  const assignment = createBlindTournamentAssignmentV32_15(spec);
  const judges: TournamentJudgeV32_15[] = judgeKeys.map((key, index) => ({ judgeId: `judge-${index}`, organizationId: `judge-org-${index}`, keyFingerprint: registry.fingerprint(key.keyId)!, calibrated: true, conflictsWithProviders: [] }));
  const trustPolicy: TournamentTrustPolicyV32_15 = {
    policyDigest: spec.policyDigest,
    providerAuthorizations: providerKeys.map((key, index) => ({ entryId: index === 0 ? 'a' : 'b', keyId: key.keyId, keyFingerprint: registry.fingerprint(key.keyId)!, authorityClass: 'LOCAL_FIXTURE' })),
    judgeAuthorizations: judgeKeys.map((key, index) => ({ judgeId: `judge-${index}`, keyId: key.keyId, keyFingerprint: registry.fingerprint(key.keyId)!, organizationId: `judge-org-${index}`, authorityClass: 'LOCAL_FIXTURE' })),
  };
  const labels = new Map(assignment.labels.map((row) => [row.entryId, row.blindLabel]));
  const submissions = spec.entries.flatMap((entry, entryIndex) => spec.tasks.map((task) => signEnvelope<TournamentSubmissionV32_15>({
    runId: spec.runId, taskId: task.taskId, blindLabel: labels.get(entry.entryId)!, entryId: entry.entryId, outputDigest: digest(`o-${entry.entryId}-${task.taskId}`), transcriptDigest: digest(`t-${entry.entryId}-${task.taskId}`), startedAt: '2026-07-20T10:00:00.000Z', completedAt: '2026-07-20T10:00:01.000Z', inputTokens: 1, outputTokens: 1, costMicros: 1, evidenceClass: spec.evidenceClass,
  }, providerKeys[entryIndex]!)));
  const scores = assignment.labels.flatMap((label, entryIndex) => spec.tasks.flatMap((task) => judges.map((judge, judgeIndex) => signEnvelope<TournamentScoreV32_15>({
    runId: spec.runId, taskId: task.taskId, blindLabel: label.blindLabel, judgeId: judge.judgeId, dimensionScores: { correctness: entryIndex === 0 ? 9 : 5 }, goldChecksPassed: ['gold'], rationaleDigest: digest(`r-${task.taskId}-${label.blindLabel}-${judge.judgeId}`), scoredAt: '2026-07-20T10:05:00.000Z',
  }, judgeKeys[judgeIndex]!))));
  return { spec, assignment, judges, trustPolicy, registry, providerKeys, judgeKeys, submissions, scores };
}

function tournamentReport(f: ReturnType<typeof tournamentFixture>, patch: Partial<Parameters<typeof evaluateBlindedFrontierTournamentV32_15>[0]> = {}) {
  return evaluateBlindedFrontierTournamentV32_15({ ...f, revealedLabels: f.assignment.labels, now, ...patch });
}

test('tournament validation and adversarial branches reject malformed specifications and trust', () => {
  const f = tournamentFixture();
  const badSpecs: TournamentRunSpecV32_15[] = [
    { ...f.spec, schemaVersion: '0' as '32.15' }, { ...f.spec, runId: '' }, { ...f.spec, sourceDigest: 'bad' },
    { ...f.spec, entries: [f.spec.entries[0]!, f.spec.entries[0]!] }, { ...f.spec, tasks: [] }, { ...f.spec, tasks: [f.spec.tasks[0]!, f.spec.tasks[0]!] },
    { ...f.spec, minimumIndependentJudges: -1 }, { ...f.spec, minimumIndependentJudges: 1 },
    { ...f.spec, entries: [{ ...f.spec.entries[0]!, providerId: '' }, f.spec.entries[1]!] }, { ...f.spec, entries: [{ ...f.spec.entries[0]!, costMicros: -1 }, f.spec.entries[1]!] },
    { ...f.spec, tasks: [{ ...f.spec.tasks[0]!, promptDigest: 'bad' }] }, { ...f.spec, tasks: [{ ...f.spec.tasks[0]!, dimensions: [] }] },
    { ...f.spec, tasks: [{ ...f.spec.tasks[0]!, dimensions: [{ dimensionId: '', weight: 1, maximumScore: 10 }] }] },
    { ...f.spec, tasks: [{ ...f.spec.tasks[0]!, dimensions: [{ dimensionId: 'x', weight: 0, maximumScore: 10 }] }] },
  ];
  for (const spec of badSpecs) assert.throws(() => createBlindTournamentAssignmentV32_15(spec));
  const badTrust: TournamentTrustPolicyV32_15[] = [
    { ...f.trustPolicy, policyDigest: 'bad' },
    { ...f.trustPolicy, providerAuthorizations: f.trustPolicy.providerAuthorizations.slice(0, 1) },
    { ...f.trustPolicy, providerAuthorizations: [f.trustPolicy.providerAuthorizations[0]!, f.trustPolicy.providerAuthorizations[0]!] },
    { ...f.trustPolicy, judgeAuthorizations: [{ ...f.trustPolicy.judgeAuthorizations[0]!, keyFingerprint: 'bad' }, f.trustPolicy.judgeAuthorizations[1]!] },
  ];
  for (const trustPolicy of badTrust) assert.throws(() => tournamentReport(f, { trustPolicy }));
  assert.throws(() => tournamentReport(f, { now: new Date('invalid') }), /tournament_now_invalid/);
});

test('tournament records every distinct submission, judge and score failure class', () => {
  const f = tournamentFixture();
  const duplicate = f.submissions[0]!;
  const malformedPayload: TournamentSubmissionV32_15 = { ...duplicate.payload, runId: 'wrong', taskId: 'missing', blindLabel: 'missing', entryId: 'wrong', outputDigest: 'bad', transcriptDigest: 'bad', startedAt: 'bad', completedAt: '2099-01-01T00:00:00.000Z', inputTokens: -1, outputTokens: 1.5, costMicros: -2, evidenceClass: 'OBSERVED_LOCAL' };
  const malformed = signEnvelope(malformedPayload, f.providerKeys[1]!);
  const expensive = signEnvelope<TournamentSubmissionV32_15>({ ...duplicate.payload, taskId: 'task-1', costMicros: 20_000 }, f.providerKeys[0]!);
  const judges = [
    { ...f.judges[0]!, calibrated: false },
    { ...f.judges[1]!, judgeId: '', keyFingerprint: 'bad', conflictsWithProviders: ['provider-a'] },
  ];
  const badScorePayload: TournamentScoreV32_15 = { ...f.scores[0]!.payload, runId: 'wrong', taskId: 'missing', blindLabel: 'missing', judgeId: 'unknown', dimensionScores: { other: 99 }, goldChecksPassed: ['bad', 'bad'], rationaleDigest: 'bad', scoredAt: 'bad' };
  const badScore = signEnvelope(badScorePayload, f.providerKeys[0]!);
  const report = tournamentReport(f, {
    assignment: { ...f.assignment, assignmentDigest: digest('bad') },
    revealedLabels: [{ entryId: 'a', blindLabel: f.assignment.labels[0]!.blindLabel }, { entryId: 'a', blindLabel: f.assignment.labels[1]!.blindLabel }],
    submissions: [duplicate, duplicate, malformed, expensive], judges, scores: [f.scores[0]!, f.scores[0]!, badScore],
    trustPolicy: { ...f.trustPolicy, policyDigest: digest('other') },
  });
  const expected = ['tournament-trust-policy-mismatch', 'blind-assignment-invalid', 'blind-reveal-invalid', 'blind-reveal-not-bijective', 'tournament-cost-budget-exceeded', 'independent-judge-quorum-missing', 'submission-matrix-incomplete', 'score-matrix-incomplete'];
  for (const code of expected) assert.equal(report.findings.includes(code), true, code);
  for (const prefix of ['duplicate-submission:', 'submission-signature-invalid:', 'submission-identity-invalid:', 'submission-digest-invalid:', 'submission-time-invalid:', 'submission-usage-invalid:', 'submission-evidence-class-mismatch:', 'duplicate-score:', 'score-signature-invalid:', 'score-identity-invalid:']) assert.equal(report.findings.some((item) => item.startsWith(prefix)), true, prefix);
});

test('tournament score branches validate dimensions ranges gold evidence diversity and external leader state', () => {
  const f = tournamentFixture(40);
  const score0 = f.scores[0]!;
  const variants = [
    signEnvelope<TournamentScoreV32_15>({ ...score0.payload, dimensionScores: { other: 1 } }, f.judgeKeys[0]!),
    signEnvelope<TournamentScoreV32_15>({ ...score0.payload, dimensionScores: { correctness: 11 } }, f.judgeKeys[0]!),
    signEnvelope<TournamentScoreV32_15>({ ...score0.payload, goldChecksPassed: ['gold', 'gold'] }, f.judgeKeys[0]!),
    signEnvelope<TournamentScoreV32_15>({ ...score0.payload, goldChecksPassed: ['unknown'] }, f.judgeKeys[0]!),
    signEnvelope<TournamentScoreV32_15>({ ...score0.payload, rationaleDigest: 'bad' }, f.judgeKeys[0]!),
  ];
  const invalid = tournamentReport(f, { scores: [...f.scores.slice(1), ...variants] });
  for (const prefix of ['score-dimensions-invalid:', 'score-range-invalid:', 'gold-check-invalid:', 'score-evidence-invalid:']) assert.equal(invalid.findings.some((item) => item.startsWith(prefix)), true, prefix);
  const oneProvider = { ...f.spec, minimumProviders: 3 };
  assert.equal(tournamentReport({ ...f, spec: oneProvider }).findings.includes('provider-diversity-insufficient'), true);

  const externalSpec = { ...f.spec, evidenceClass: 'OBSERVED_EXTERNAL' as const, entries: f.spec.entries.map((entry) => ({ ...entry, evidenceClass: 'OBSERVED_EXTERNAL' as const })) };
  const externalAssignment = createBlindTournamentAssignmentV32_15(externalSpec);
  const externalLabels = new Map(externalAssignment.labels.map((row) => [row.entryId, row.blindLabel]));
  const externalSubmissions = externalSpec.entries.flatMap((entry, entryIndex) => externalSpec.tasks.map((task) => signEnvelope<TournamentSubmissionV32_15>({ ...f.submissions[0]!.payload, runId: externalSpec.runId, taskId: task.taskId, blindLabel: externalLabels.get(entry.entryId)!, entryId: entry.entryId, outputDigest: digest(`eo-${entry.entryId}-${task.taskId}`), transcriptDigest: digest(`et-${entry.entryId}-${task.taskId}`), evidenceClass: 'OBSERVED_EXTERNAL' }, f.providerKeys[entryIndex]!)));
  const externalScores = externalAssignment.labels.flatMap((label, entryIndex) => externalSpec.tasks.flatMap((task) => f.judges.map((judge, judgeIndex) => signEnvelope<TournamentScoreV32_15>({ ...f.scores[0]!.payload, taskId: task.taskId, blindLabel: label.blindLabel, judgeId: judge.judgeId, dimensionScores: { correctness: entryIndex === 0 ? 10 : 0 }, rationaleDigest: digest(`er-${task.taskId}-${label.blindLabel}-${judge.judgeId}`) }, f.judgeKeys[judgeIndex]!))));
  const externalTrust: TournamentTrustPolicyV32_15 = { ...f.trustPolicy, providerAuthorizations: f.trustPolicy.providerAuthorizations.map((row) => ({ ...row, authorityClass: 'EXTERNAL_PINNED' })), judgeAuthorizations: f.trustPolicy.judgeAuthorizations.map((row) => ({ ...row, authorityClass: 'EXTERNAL_PINNED' })) };
  const external = evaluateBlindedFrontierTournamentV32_15({ spec: externalSpec, assignment: externalAssignment, submissions: externalSubmissions, judges: f.judges, scores: externalScores, revealedLabels: externalAssignment.labels, registry: f.registry, trustPolicy: externalTrust, now });
  assert.equal(external.verdict, 'FRONTIER_LEADER_CANDIDATE');
});

const here = dirname(fileURLToPath(import.meta.url));
const wasmBytes = readFileSync(join(here, '..', '..', 'isolation', 'wasm-core', 'artifacts', 'allowed.wasm'));
const iface = { interfaceId: 'upp:assurance/verify', version: '1.0.0' } as const;
function wasmFixture() {
  const policy: WasmComponentPolicyV32_15 = { policyDigest: digest('wp'), allowedWasiProfiles: ['wasi-0.2'], allowedImports: ['upp:assurance/input@1.0.0'], allowedExports: ['upp:assurance/verify@1.0.0'], allowedCapabilities: ['filesystem-read', 'network-client', 'clocks-monotonic'], deniedCapabilities: ['network-listen', 'secrets'], maximumMemoryBytes: 1_000_000, maximumExecutionMs: 1_000, maximumFuel: 1_000_000, requireDeterminism: true, requireIndependentReview: true, production: false };
  const manifest: ProofCarryingWasmComponentManifestV32_15 = { schemaVersion: '32.15', componentId: 'component', version: '1.0.0', tenantId: 'tenant', world: 'upp:assurance/world', wasiProfile: 'wasi-0.2', binaryDigest: sha256Bytes(wasmBytes), sourceDigest: digest('ws'), toolchainDigest: digest('wt'), policyDigest: policy.policyDigest, imports: [{ interfaceId: 'upp:assurance/input', version: '1.0.0' }], exports: [iface], grants: [{ capability: 'filesystem-read', resources: ['/data/a'] }, { capability: 'clocks-monotonic', resources: ['mono'] }], deterministic: true, maximumMemoryBytes: 1000, maximumExecutionMs: 100, maximumFuel: 1000, publisherId: 'publisher', reviewerId: 'reviewer', publisherKeyFingerprint: digest('pk'), reviewerKeyFingerprint: digest('rk'), evidenceClass: 'SYNTHETIC', runtimeQualified: false, synthetic: true };
  return { policy, manifest };
}

test('WASM admission covers policy lineage resources capabilities and structure branches', () => {
  const f = wasmFixture();
  const report = evaluateWasmComponentAdmissionV32_15({ bytes: Buffer.from('not-wasm'), manifest: { ...f.manifest, policyDigest: digest('other'), wasiProfile: 'wasi-0.3', deterministic: false, maximumMemoryBytes: 2_000_000, imports: [{ interfaceId: 'upp:other/input', version: '1.0.0' }], exports: [{ interfaceId: 'upp:other/output', version: '1.0.0' }], grants: [{ capability: 'filesystem-read', resources: [] }, { capability: 'network-client', resources: ['http://bad'] }] }, policy: f.policy });
  for (const code of ['component-binary-digest-mismatch', 'component-policy-digest-mismatch', 'component-wasi-profile-denied', 'component-nondeterministic', 'component-resource-limit-exceeded', 'component-import-denied', 'component-export-denied', 'component-grant-resources-invalid:filesystem-read', 'component-network-resource-invalid:network-client', 'component-binary-structure-invalid']) assert.equal(report.findings.includes(code), true, code);
  const denied = evaluateWasmComponentAdmissionV32_15({ bytes: wasmBytes, manifest: { ...f.manifest, grants: [{ capability: 'network-listen', resources: ['https://example.com'] }] }, policy: f.policy });
  assert.equal(denied.findings.includes('component-capability-denied'), true);
  const duplicateResources = evaluateWasmComponentAdmissionV32_15({ bytes: wasmBytes, manifest: { ...f.manifest, grants: [{ capability: 'filesystem-read', resources: ['/data/a', '/data/a'] }] }, policy: f.policy });
  assert.equal(duplicateResources.findings.some((x) => x.startsWith('component-grant-resources-invalid')), true);
});

test('WASM manifest, policy, interface and composition validation fail closed across edge cases', () => {
  const f = wasmFixture();
  const manifests: ProofCarryingWasmComponentManifestV32_15[] = [
    { ...f.manifest, schemaVersion: '0' as '32.15' }, { ...f.manifest, componentId: '' }, { ...f.manifest, sourceDigest: 'bad' }, { ...f.manifest, maximumFuel: 0 },
    { ...f.manifest, imports: [f.manifest.imports[0]!, f.manifest.imports[0]!] }, { ...f.manifest, grants: [f.manifest.grants[0]!, f.manifest.grants[0]!] },
    { ...f.manifest, imports: [{ interfaceId: 'BAD', version: '1.0.0' }] }, { ...f.manifest, exports: [{ interfaceId: iface.interfaceId, version: 'bad' }] },
  ];
  for (const manifest of manifests) assert.throws(() => evaluateWasmComponentAdmissionV32_15({ bytes: wasmBytes, manifest, policy: f.policy }));
  const policies: WasmComponentPolicyV32_15[] = [
    { ...f.policy, policyDigest: 'bad' }, { ...f.policy, allowedWasiProfiles: [] }, { ...f.policy, maximumExecutionMs: 0 }, { ...f.policy, allowedCapabilities: ['secrets'] },
  ];
  for (const policy of policies) assert.throws(() => evaluateWasmComponentAdmissionV32_15({ bytes: wasmBytes, manifest: f.manifest, policy }));
  assert.throws(() => evaluateWasmComponentCompositionV32_15([]));
  assert.throws(() => evaluateWasmComponentCompositionV32_15([{ componentId: 'x', imports: [], exports: [] }, { componentId: 'x', imports: [], exports: [] }]));
  const unsatisfied = evaluateWasmComponentCompositionV32_15([{ componentId: 'consumer', imports: [iface], exports: [] }]);
  assert.equal(unsatisfied.findings.some((x) => x.startsWith('component-import-unsatisfied')), true);
  const self = evaluateWasmComponentCompositionV32_15([{ componentId: 'self', imports: [iface], exports: [iface] }]);
  assert.equal(self.findings.some((x) => x.startsWith('component-self-binding')), true);
});

function multiFixture(mode: MultiHostChallengeV32_15['mode'] = 'LOCAL_PROCESS_DRY_RUN') {
  const challenge = issueMultiHostChallengeV32_15({ qualificationId: 'mq', runId: 'mr', sourceDigest: digest('ms'), buildDigest: digest('mb'), toolchainDigest: digest('mt'), environmentDigest: digest('me'), policyDigest: digest('mp'), nonce: 'nonce', sequence: 1, issuedAt: '2026-07-20T10:00:00.000Z', expiresAt: '2026-07-20T12:00:00.000Z', requiredHosts: 2, requiredProviders: mode === 'LOCAL_PROCESS_DRY_RUN' ? 1 : 2, mode });
  const identities = [generateSigningIdentity('mh-a'), generateSigningIdentity('mh-b')];
  const registry = new KeyRegistry(); identities.forEach((id) => registry.register(id.keyId, id.publicKey));
  const observation = (index: number): MultiHostObservationV32_15 => ({ qualificationId: challenge.qualificationId, runId: challenge.runId, hostId: `host-${index}`, hostFingerprint: digest(`hf-${index}`), providerId: mode === 'LOCAL_PROCESS_DRY_RUN' ? 'local' : `provider-${index}`, regionId: `region-${index}`, organizationId: mode === 'INDEPENDENT_ORGANIZATION' ? `org-${index}` : 'org', sourceDigest: challenge.sourceDigest, buildDigest: challenge.buildDigest, toolchainDigest: challenge.toolchainDigest, environmentDigest: challenge.environmentDigest, policyDigest: challenge.policyDigest, nonce: challenge.nonce, sequence: challenge.sequence, observedAt: '2026-07-20T10:30:00.000Z', externalResponseId: `response-${index}`, rawEvidenceDigest: digest(`raw-${index}`), failoverSucceeded: true, partitionContained: true, revocationPropagated: true, recoveryRtoSeconds: 2, recoveryRpoSeconds: 1, synthetic: mode === 'LOCAL_PROCESS_DRY_RUN' });
  const responses = identities.map((identity, index) => signMultiHostObservationV32_15(observation(index), identity));
  const trustPolicy: MultiHostTrustPolicyV32_15 = { policyDigest: challenge.policyDigest, hostAuthorizations: identities.map((identity, index) => ({ keyId: identity.keyId, keyFingerprint: registry.fingerprint(identity.keyId)!, hostId: `host-${index}`, hostFingerprint: digest(`hf-${index}`), providerId: mode === 'LOCAL_PROCESS_DRY_RUN' ? 'local' : `provider-${index}`, organizationId: mode === 'INDEPENDENT_ORGANIZATION' ? `org-${index}` : 'org', authorityClass: mode === 'LOCAL_PROCESS_DRY_RUN' ? 'LOCAL_FIXTURE' : 'EXTERNAL_PINNED' })) };
  return { challenge, identities, registry, observation, responses, trustPolicy };
}

test('multi-host validation rejects malformed challenge observation trust and evaluation limits', () => {
  const f = multiFixture();
  const challenges = [
    { ...f.challenge, schemaVersion: '0' as '32.15' }, { ...f.challenge, qualificationId: '' }, { ...f.challenge, sourceDigest: 'bad' }, { ...f.challenge, sequence: 0 },
    { ...f.challenge, requiredHosts: 1 }, { ...f.challenge, requiredProviders: 3 }, { ...f.challenge, issuedAt: 'bad' }, { ...f.challenge, expiresAt: f.challenge.issuedAt },
  ];
  for (const challenge of challenges) assert.throws(() => evaluateMultiHostChallengeV32_15({ challenge, responses: f.responses, registry: f.registry, trustPolicy: f.trustPolicy, now, maximumRtoSeconds: 10, maximumRpoSeconds: 10 }));
  assert.throws(() => evaluateMultiHostChallengeV32_15({ ...f, now: new Date('bad'), maximumRtoSeconds: 10, maximumRpoSeconds: 10 }));
  assert.throws(() => evaluateMultiHostChallengeV32_15({ ...f, now, maximumRtoSeconds: -1, maximumRpoSeconds: 10 }));
  const invalidObservation = { ...f.observation(0), hostId: '' };
  assert.throws(() => signMultiHostObservationV32_15(invalidObservation, f.identities[0]!));
  const badTrusts: MultiHostTrustPolicyV32_15[] = [
    { ...f.trustPolicy, policyDigest: 'bad' }, { ...f.trustPolicy, hostAuthorizations: f.trustPolicy.hostAuthorizations.slice(0, 1) },
    { ...f.trustPolicy, hostAuthorizations: [f.trustPolicy.hostAuthorizations[0]!, f.trustPolicy.hostAuthorizations[0]!] },
    { ...f.trustPolicy, hostAuthorizations: [{ ...f.trustPolicy.hostAuthorizations[0]!, keyFingerprint: 'bad' }, f.trustPolicy.hostAuthorizations[1]!] },
  ];
  for (const trustPolicy of badTrusts) assert.throws(() => evaluateMultiHostChallengeV32_15({ challenge: f.challenge, responses: f.responses, registry: f.registry, trustPolicy, now, maximumRtoSeconds: 10, maximumRpoSeconds: 10 }));
});

test('multi-host evaluation records malformed, duplicate, lineage, time, recovery and quorum failures', () => {
  const f = multiFixture('INDEPENDENT_ORGANIZATION');
  const malformed = { ...f.responses[0]!, payload: { ...f.responses[0]!.payload, hostId: '' } };
  const badObservation = { ...f.observation(1), organizationId: 'org-0', qualificationId: 'wrong', runId: 'wrong', sourceDigest: digest('wrong'), buildDigest: digest('wrong2'), toolchainDigest: digest('wrong3'), environmentDigest: digest('wrong4'), policyDigest: digest('wrong5'), nonce: 'wrong', sequence: 2, observedAt: '2026-07-20T09:00:00.000Z', failoverSucceeded: false, partitionContained: false, revocationPropagated: false, recoveryRtoSeconds: 100, recoveryRpoSeconds: 100, synthetic: true };
  const signedBad = signMultiHostObservationV32_15(badObservation, f.identities[0]!);
  const rogue = generateSigningIdentity('rogue-host'); f.registry.register(rogue.keyId, rogue.publicKey);
  const unauthorized = signMultiHostObservationV32_15({ ...f.observation(0), hostId: 'rogue-host', hostFingerprint: digest('rogue-host') }, rogue);
  const report = evaluateMultiHostChallengeV32_15({ challenge: { ...f.challenge, requiredHosts: 4, requiredProviders: 4 }, responses: [malformed, f.responses[0]!, signedBad, unauthorized], registry: f.registry, trustPolicy: { ...f.trustPolicy, policyDigest: digest('other') }, now, maximumRtoSeconds: 10, maximumRpoSeconds: 10 });
  for (const code of ['observation-shape-invalid', 'multi-host-trust-policy-mismatch', 'host-quorum-missing', 'provider-diversity-missing', 'organization-independence-missing']) assert.equal(report.findings.includes(code), true, code);
  for (const prefix of ['observation-signature-invalid:', 'observation-key-reused:', 'observation-authorization-mismatch:', 'observation-lineage-mismatch:', 'observation-time-invalid:', 'failover-failed:', 'partition-not-contained:', 'revocation-not-propagated:', 'rto-exceeded:', 'rpo-exceeded:', 'external-observation-untrusted:']) assert.equal(report.findings.some((x) => x.startsWith(prefix)), true, prefix);
});
