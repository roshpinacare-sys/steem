import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentAddressedArtifactStore } from '../artifacts/content-addressed-store.js';
import { evidenceDigest, type ActionPassport, type AuthorityGrant, type EvidenceRecord } from '../contracts/canonical.js';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../contracts/crypto.js';
import { buildDecisionBrief } from '../product/decision-brief.js';
import { capabilityRef, PersistentCapabilityTrustStore } from '../platform/capability-trust.js';
import { SovereignDomainPackGenerator, type DomainSpecification } from '../platform/domain-pack-generator.js';
import { DigitalThread, type ThreadNodeKind } from '../platform/digital-thread.js';
import { EvidenceCompletenessGate } from '../platform/evidence-completeness.js';
import { IncidentToRecertificationPipeline } from '../platform/incident-recertification.js';
import { createOfflineVerificationBundle, verifyOfflineVerificationBundle } from '../platform/offline-verification.js';
import { attestTestExecution } from '../platform/test-execution-provenance.js';
import { KeyLifecycleRegistry, type KeyDescriptor } from '../security/key-lifecycle.js';

const now = new Date('2026-07-17T14:00:00.000Z');
const root = mkdtempSync(join(tmpdir(), 'canonical-v21-demo-'));
const tenantId = 'tenant-1';
const subjectId = 'candidate-1';

const authorityIdentity = generateSigningIdentity('v21-authority');
const passportIdentity = generateSigningIdentity('v21-passport');
const testRunnerIdentity = generateSigningIdentity('v22-test-runner');
const basicRegistry = new KeyRegistry();
basicRegistry.register(authorityIdentity.keyId, authorityIdentity.publicKey);
basicRegistry.register(passportIdentity.keyId, passportIdentity.publicKey);
basicRegistry.register(testRunnerIdentity.keyId, testRunnerIdentity.publicKey);
const grant: AuthorityGrant = { grantId: 'grant-v21', tenantId, subjectId, scopes: ['release.shadow'], issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600_000).toISOString(), issuer: 'canonical-kernel' };
const expectedTestExecution = {
  tenantId, subjectId, command: ['node', '--test', 'dist/tests'], authorizedRunnerIds: [testRunnerIdentity.keyId],
  inputArtifactDigest: sha256('candidate-input'), outputArtifactDigest: sha256('test-report'), environmentDigest: sha256({ node: process.version, os: process.platform }),
  testManifestDigest: sha256('test-manifest'), testFilesDigest: sha256(['dist/tests']), maximumAgeMs: 300_000,
} as const;
const testExecutionAttestation = attestTestExecution({
  executionId: 'execution-v22-demo', tenantId, subjectId, command: expectedTestExecution.command, runnerId: testRunnerIdentity.keyId,
  inputArtifactDigest: expectedTestExecution.inputArtifactDigest, outputArtifactDigest: expectedTestExecution.outputArtifactDigest,
  capturedOutputDigest: sha256('tap-output'), environmentDigest: expectedTestExecution.environmentDigest,
  testManifestDigest: expectedTestExecution.testManifestDigest, testFilesDigest: expectedTestExecution.testFilesDigest,
  startedAt: new Date(now.getTime() - 1_000).toISOString(), finishedAt: new Date(now.getTime() - 500).toISOString(), exitStatus: 0,
}, testRunnerIdentity);
const evidenceRecords = chain([
  evidence('tests', 'test-report', 'ATTESTED', { executed: true, passed: true, failCount: 0, reportDigest: sha256('test-report'), testManifestDigest: sha256('test-manifest'), attestationDigest: sha256(testExecutionAttestation) }),
  evidence('artifact', 'artifact-manifest', 'COMPUTED', { artifactDigest: sha256('artifact') }),
  evidence('claims', 'unsupported-claims', 'OBSERVED', { claims: ['not-production-qualified'] }),
  evidence('rollback', 'rollback-verification', 'OBSERVED', { passed: true }),
]);
const evidenceRoot = evidenceDigest(evidenceRecords.at(-1)!);
const thread = buildThread(evidenceRoot);
const passportPayload: ActionPassport = { passportId: 'passport-v21', tenantId, subject: subjectId, authorityGrantDigest: sha256(grant), evidenceRoot, promotionState: 'shadow', issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600_000).toISOString(), reviewerIds: ['reviewer-1'], limitations: ['shadow-only'] };
const evidenceDecision = new EvidenceCompletenessGate().evaluate({
  tenantId, subjectId, builderId: 'builder-1', reviewerIds: ['reviewer-1'], requiredScope: 'release.shadow', authority: signEnvelope(grant, authorityIdentity), keyRegistry: basicRegistry,
  evidenceRecords, evidenceRoot, requiredEvidenceKinds: ['test-report', 'artifact-manifest', 'unsupported-claims', 'rollback-verification'], requiredEvidenceClasses: ['ATTESTED', 'COMPUTED', 'OBSERVED'],
  expectedTestReportDigest: sha256('test-report'), expectedTestManifestDigest: sha256('test-manifest'), expectedArtifactDigest: sha256('artifact'),
  testExecutionAttestation, expectedTestExecution, rollback: { ref: 'rollback:v21', verified: true },
  digitalThread: thread, requiredThreadKinds: ['AUTHORITY_GRANT', 'COMMITMENT', 'REQUIREMENT', 'MISSION', 'ARTIFACT', 'EVIDENCE', 'CERTIFICATION', 'PASSPORT'], passport: signEnvelope(passportPayload, passportIdentity),
}, now);

const trustStore = new PersistentCapabilityTrustStore(join(root, 'capability-trust'));
const capability = trustStore.register({ tenantId, capabilityId: 'repository-change', version: '1.0.0', publisherId: 'publisher-1', originalScopes: ['repository.read', 'repository.write', 'evidence.emit'] }, now);
const ref = capabilityRef(capability.capabilityId, capability.version);
const artifacts = new ContentAddressedArtifactStore(join(root, 'artifacts'));
const incidentPipeline = new IncidentToRecertificationPipeline(trustStore, artifacts);
const plan = incidentPipeline.open({ incidentId: 'incident-v21', tenantId, capabilityRef: ref, category: 'FALSE_COMPLETION_CLAIM', severity: 'HIGH', subject: subjectId, evidenceRefs: ['evidence:false-claim'], affectedContracts: ['contract.change'], affectedArtifacts: ['artifact.patch'], reportedBy: 'operator-1', occurredAt: now.toISOString(), summary: 'Completion was claimed without complete evidence.' }, now);
const recertEvidence = chain([
  evidence('regression', 'regression-test', 'ATTESTED', { passed: true }),
  evidence('monitor', 'runtime-monitor', 'ATTESTED', { passed: true }),
  evidence('integrity', 'artifact-integrity', 'ATTESTED', { passed: true }),
]);
const recertRoot = evidenceDigest(recertEvidence.at(-1)!);
const recertification = incidentPipeline.recertify({ caseId: plan.caseId, evidenceRecords: recertEvidence, evidenceRoot: recertRoot, reviewerIds: ['reviewer-1', 'reviewer-2'], restoredScopes: ['repository.read', 'evidence.emit'] }, new Date(now.getTime() + 1));

const generator = new SovereignDomainPackGenerator();
const jewelry = generator.approve(generator.generate(domain('jewelry-engineering', ['design', 'material'], 'design-certification', ['jewelry.design.read', 'evidence.emit'], ['SIMULATED', 'ATTESTED'])), ['domain-reviewer-1', 'domain-reviewer-2']);
const irrigation = generator.approve(generator.generate(domain('irrigation-control', ['valve', 'water-head', 'program'], 'schedule-validation', ['irrigation.plan.read', 'irrigation.schedule.propose', 'evidence.emit'], ['COMPUTED', 'OBSERVED', 'ATTESTED'])), ['domain-reviewer-1', 'domain-reviewer-2']);

const offlineRegistry = new KeyLifecycleRegistry();
const offlinePassport = generateSigningIdentity('offline-passport-v21');
const offlineEvidence = generateSigningIdentity('offline-evidence-v21');
offlineRegistry.register(offlinePassport, descriptor(offlinePassport.keyId, 'action-passport'));
offlineRegistry.register(offlineEvidence, descriptor(offlineEvidence.keyId, 'evidence-attestation'));
const bundle = createOfflineVerificationBundle({ registry: offlineRegistry, passportIdentity: offlinePassport, attestationIdentity: offlineEvidence, passport: passportPayload, artifacts: [{ name: 'change.patch', digest: sha256('patch'), mediaType: 'text/x-diff', byteLength: 100 }, { name: 'test-report.json', digest: sha256('tests'), mediaType: 'application/json', byteLength: 200 }], now, ttlMs: 3600_000 });
const offlineVerification = verifyOfflineVerificationBundle(bundle, { now, minimumTrustEpoch: bundle.trustSnapshot.epoch });

const decisionBrief = buildDecisionBrief({ status: 'AWAITING_REVIEW', objective: 'Correct bounded repository defect', changedFiles: ['src/calculator.js'], findings: [{ kind: 'PROMPT_INJECTION', severity: 'high', file: 'README.md', ruleId: 'PI-EXFIL', summary: 'Repository text requested secret exfiltration.' }], testPassed: true, evidenceRoot, unsupportedClaims: ['not-production-qualified'], rollbackAvailable: true, passportAvailable: false, repositoryTrust: 'trusted-fixture', testExecutionBoundary: 'trusted-local-process' });

console.log(JSON.stringify({
  status: 'V21_BREAKTHROUGH_INTEGRATION_PROOF_COMPLETED',
  evidenceCompleteness: { status: evidenceDecision.status, digest: evidenceDecision.decisionDigest },
  incidentToRecertification: { planStatus: plan.status, restoredStatus: recertification.capabilityState.status, threadRoot: recertification.digitalThreadRoot },
  capabilityTrust: { persistent: new PersistentCapabilityTrustStore(join(root, 'capability-trust')).verify().ok, finalStatus: trustStore.get(tenantId, ref).status },
  domainPacks: [{ id: jewelry.manifest.packId, status: jewelry.status }, { id: irrigation.manifest.packId, status: irrigation.status }],
  offlineVerification: { ok: offlineVerification.ok, trustEpoch: offlineVerification.trustEpoch, artifactCount: offlineVerification.artifactCount },
  decisionBrief: { recommendation: decisionBrief.recommendation, structuralReductionPercent: decisionBrief.reviewDataProxy.reductionPercent, limitation: decisionBrief.reviewDataProxy.limitation },
  productionQualified: false,
  externalMutation: 'disabled',
  untrustedRepositoryExecution: 'blocked',
}, null, 2));

function evidence(recordId: string, kind: string, evidenceClass: EvidenceRecord['evidenceClass'], payload: Record<string, unknown>): EvidenceRecord {
  return { recordId, tenantId, kind, subject: subjectId, payload, evidenceClass, method: 'v21.demo', environment: { runtime: 'node' }, createdAt: now.toISOString(), limitations: [] };
}
function chain(records: readonly EvidenceRecord[]): EvidenceRecord[] { let previous: string | undefined; return records.map((item) => { const current = previous === undefined ? item : { ...item, previousDigest: previous }; previous = evidenceDigest(current); return current; }); }
function buildThread(rootDigest: string): DigitalThread {
  const threadValue = new DigitalThread();
  const kinds: ThreadNodeKind[] = ['AUTHORITY_GRANT', 'COMMITMENT', 'REQUIREMENT', 'MISSION', 'ARTIFACT', 'EVIDENCE', 'CERTIFICATION', 'PASSPORT'];
  kinds.forEach((kind, index) => { threadValue.addNode({ nodeId: `v21-${kind}`, tenantId, kind, subject: subjectId, payloadDigest: kind === 'EVIDENCE' ? rootDigest : sha256(kind), createdAt: now.toISOString() }); if (index > 0) threadValue.addEdge({ edgeId: `v21-edge-${index}`, tenantId, fromNodeId: `v21-${kinds[index - 1]}`, toNodeId: `v21-${kind}`, relation: 'SUPPORTS', createdAt: now.toISOString() }); });
  return threadValue;
}
function descriptor(keyId: string, purpose: KeyDescriptor['purpose']) { return { keyId, familyId: `family-${purpose}`, purpose, environment: 'airgap' as const, tenantId, notBefore: new Date(now.getTime() - 1000).toISOString(), notAfter: new Date(now.getTime() + 3600_000).toISOString() }; }
function domain(domainId: string, entities: string[], workflowId: string, scopes: string[], evidenceClasses: EvidenceRecord['evidenceClass'][]): DomainSpecification { return { domainId, version: '1.0.0', ontologyVersion: '1.0', entities, workflows: [{ workflowId, goal: `Validate ${domainId}`, actions: ['analyze', 'verify'], requiredScopes: scopes, evidenceClasses }], requirements: [{ statement: `${domainId} must pass declared gates before shadow use.`, criticality: 'HIGH', verificationModes: ['TEST', 'REVIEW'], evidenceClasses }], uiNeeds: ['review', 'evidence'], risks: ['Domain assumptions may be incomplete.'], assumptions: ['Domain inputs are supplied by an authorized operator.'], sourceRefs: ['v21-behavioral-reimplementation'] }; }
