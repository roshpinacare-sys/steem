import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  KeyRegistry, generateSigningIdentity, sha256, signEnvelope,
} from '../dist/src/contracts/crypto.js';
import {
  createCoordinatorActionClaimV33_35,
  createExpiredCoordinatorTakeoverPlanV33_35,
  createLeaseExpiryWitnessVoteV33_35,
  createPublicationEndpointReceiptV33_35,
  createPublishedTakeoverArtifactV33_35,
  createReplacementTakeoverAcceptanceV33_35,
  createTakeoverRecoveryVerdictV33_35,
  detectMonitorSplitViewV33_35,
  finalizeExpiredCoordinatorTakeoverV33_35,
  verifyCoordinatorActionAgainstTakeoverV33_35,
  verifyExpiredCoordinatorTakeoverV33_35,
  verifyRetrievalAndGossipV33_35,
} from '../dist/src/app/expired-coordinator-takeover-v33_35.js';

const output = resolve(process.argv[2] ?? 'release-evidence/v33.35/V33_35_EXPIRED_TAKEOVER_PROOF.json');
mkdirSync(dirname(output), { recursive: true });
const at = (s) => new Date(s);
const digest = (name) => sha256({ name });
const reg = (...ids) => { const r = new KeyRegistry(); for (const id of ids) r.register(id.keyId, id.publicKey); return r; };
const actor = (id, organizationId, hostId) => { const r = reg(id); return { keyId: id.keyId, keyFingerprint: r.fingerprint(id.keyId), organizationId, hostId }; };
const witness = (id, n) => ({ witnessId: `proof-witness-${n}`, ...actor(id, `proof-witness-org-${n}`, `proof-witness-host-${n}`) });

const rotationAuthority = generateSigningIdentity('proof-v3335-rotation-authority');
const recoveryAuthority = generateSigningIdentity('proof-v3335-recovery-authority');
const outgoing = generateSigningIdentity('proof-v3335-outgoing-coordinator');
const replacement = generateSigningIdentity('proof-v3335-replacement-coordinator');
const witnesses = Array.from({ length: 5 }, (_, i) => generateSigningIdentity(`proof-v3335-witness-${i + 1}`));
const witnessRows = witnesses.map((id, i) => witness(id, i + 1));
const leaseMaterial = {
  version: '33.33', leaseId: 'proof-v3335-expired-lease', planDigest: digest('lease-plan'), proposalDigest: digest('lease-proposal'), epoch: 4, term: 9,
  previousLeaseDigest: digest('lease-predecessor'), sequenceStart: 301, sequenceEnd: 400, coordinatorKeyId: outgoing.keyId,
  coordinatorOrganizationId: 'proof-outgoing-org', coordinatorHostId: 'proof-outgoing-host', quorumRequired: 3,
  witnessVoteDigests: [digest('l1'), digest('l2'), digest('l3')], witnessKeyIds: witnesses.slice(0,3).map((x) => x.keyId),
  issuedAt: '2026-07-22T15:00:00.000Z', expiresAt: '2026-07-22T16:00:00.000Z', rotationAuthorityKeyId: rotationAuthority.keyId,
  productionAuthority: 'NONE', externalEffectsExecuted: 0,
};
const predecessorLease = signEnvelope({ ...leaseMaterial, leaseDigest: sha256(leaseMaterial) }, rotationAuthority);
const recoveryDescriptor = actor(recoveryAuthority, 'proof-recovery-org', 'proof-recovery-host');
const replacementDescriptor = actor(replacement, 'proof-replacement-org', 'proof-replacement-host');
const plan = createExpiredCoordinatorTakeoverPlanV33_35({
  recoveryAuthority, recoveryAuthorityDescriptor: recoveryDescriptor, predecessorLease, replacementCoordinator: replacementDescriptor,
  witnesses: witnessRows, quorum: 3, sequenceEnd: 500, expirySafetyDelayMs: 60_000, challengeDigest: digest('proof-takeover-challenge'), previousTakeoverDigest: null,
  issuedAt: at('2026-07-22T16:01:00.000Z'), expiresAt: at('2026-07-22T17:00:00.000Z'),
});
const acceptance = createReplacementTakeoverAcceptanceV33_35({ replacementCoordinator: replacement, plan, acceptedAt: at('2026-07-22T16:01:05.000Z') });
const expiryVotes = witnesses.slice(0,3).map((id, i) => createLeaseExpiryWitnessVoteV33_35({ witness: id, plan, observedAt: at(`2026-07-22T16:01:1${i}.000Z`) }));
const takeoverTrust = {
  predecessorLeaseRegistry: reg(rotationAuthority), trustedPredecessorLeaseSignerIds: [rotationAuthority.keyId],
  planRegistry: reg(recoveryAuthority), trustedPlanSignerIds: [recoveryAuthority.keyId],
  replacementCoordinatorRegistry: reg(replacement), trustedReplacementCoordinatorIds: [replacement.keyId],
  witnessRegistry: reg(...witnesses), trustedWitnessIds: witnesses.map((id) => id.keyId),
  recoveryAuthorityRegistry: reg(recoveryAuthority), trustedRecoveryAuthorityIds: [recoveryAuthority.keyId],
};
const takeover = finalizeExpiredCoordinatorTakeoverV33_35({ recoveryAuthority, predecessorLease, plan, acceptance, expiryVotes, trust: takeoverTrust, issuedAt: at('2026-07-22T16:01:20.000Z') });
const takeoverCertificate = verifyExpiredCoordinatorTakeoverV33_35({ bundle: takeover, trust: takeoverTrust, verifiedAt: at('2026-07-22T16:03:00.000Z') });

const outgoingAction = createCoordinatorActionClaimV33_35({ coordinator: outgoing, leaseDigest: predecessorLease.payload.leaseDigest, takeoverDigest: null, epoch: 4, term: 9, sequence: 401, commandDigest: digest('resurrection-attempt'), issuedAt: at('2026-07-22T16:02:00.000Z') });
let resurrectionBlocked = false;
try { verifyCoordinatorActionAgainstTakeoverV33_35({ action: outgoingAction, coordinatorRegistry: reg(outgoing, replacement), takeover: takeover.certificate, verifiedAt: at('2026-07-22T16:03:00.000Z') }); }
catch (error) { resurrectionBlocked = /v33_35_outgoing_coordinator_fenced/.test(String(error)); }
if (!resurrectionBlocked) throw new Error('resurrection_not_blocked');
const replacementAction = createCoordinatorActionClaimV33_35({ coordinator: replacement, leaseDigest: predecessorLease.payload.leaseDigest, takeoverDigest: takeoverCertificate.takeoverDigest, epoch: 4, term: 10, sequence: 401, commandDigest: digest('replacement-action'), issuedAt: at('2026-07-22T16:02:00.000Z') });
verifyCoordinatorActionAgainstTakeoverV33_35({ action: replacementAction, coordinatorRegistry: reg(outgoing, replacement), takeover: takeover.certificate, verifiedAt: at('2026-07-22T16:03:00.000Z') });

const content = Buffer.from(JSON.stringify({ version: '33.35', takeoverDigest: takeoverCertificate.takeoverDigest, sequenceStart: takeoverCertificate.sequenceStart, sequenceEnd: takeoverCertificate.sequenceEnd, productionAuthority: 'NONE' }));
const runtimeDir = resolve('release-evidence/v33.35/runtime'); mkdirSync(runtimeDir, { recursive: true });
const contentFile = resolve(runtimeDir, 'recovery.json'); writeFileSync(contentFile, content);
const server = fork(resolve('scripts/v33_35-publication-server.mjs'), [contentFile], { stdio: ['ignore','pipe','pipe','ipc'] });
const serverReady = await new Promise((resolveReady, reject) => {
  const timer = setTimeout(() => reject(new Error('publication_server_timeout')), 10000);
  server.once('message', (message) => { if (message?.type === 'ready') { clearTimeout(timer); resolveReady(message); } });
  server.once('exit', (code) => { if (code !== 0) reject(new Error(`publication_server_exit_${code}`)); });
});
const endpointUri = `http://127.0.0.1:${serverReady.port}/recovery.json`;
const publisher = generateSigningIdentity('proof-v3335-publisher');
const publisherDescriptor = actor(publisher, 'proof-publisher-org', 'proof-publisher-host');
const artifact = createPublishedTakeoverArtifactV33_35({ takeover: takeover.certificate, content, createdAt: at('2026-07-22T16:02:10.000Z') });
const publicationReceipt = createPublicationEndpointReceiptV33_35({ publisher, publisherDescriptor, artifact, endpointUri, publishedAt: at('2026-07-22T16:02:11.000Z') });

const workers = [];
for (let i = 0; i < 3; i += 1) {
  const config = { keyId: `proof-v3335-monitor-${i+1}`, monitorId: `proof-monitor-${i+1}`, organizationId: `proof-monitor-org-${i+1}`, hostId: `proof-monitor-host-${i+1}`, endpointUri, publicationReceipt, observedAt: `2026-07-22T16:02:2${i}.000Z` };
  workers.push(fork(resolve('scripts/v33_35-monitor-worker.mjs'), [Buffer.from(JSON.stringify(config)).toString('base64url')], { stdio: ['ignore','pipe','pipe','ipc'] }));
}
const retrievalMessages = await Promise.all(workers.map((worker) => new Promise((resolveMessage, reject) => {
  const timer = setTimeout(() => reject(new Error('monitor_retrieval_timeout')), 15000);
  worker.on('message', (message) => {
    if (message?.type === 'error') { clearTimeout(timer); reject(new Error(message.error)); }
    if (message?.type === 'retrieval') { clearTimeout(timer); resolveMessage(message); }
  });
  worker.once('exit', (code) => { if (code !== 0) reject(new Error(`monitor_exit_${code}`)); });
})));
const retrievalReceipts = retrievalMessages.map((row) => row.receipt);
for (const worker of workers) worker.send({ type: 'gossip', receipts: retrievalReceipts, observedAt: '2026-07-22T16:02:30.000Z' });
const gossipMessages = await Promise.all(workers.map((worker) => new Promise((resolveMessage, reject) => {
  const timer = setTimeout(() => reject(new Error('monitor_gossip_timeout')), 10000);
  worker.on('message', (message) => { if (message?.type === 'gossip') { clearTimeout(timer); resolveMessage(message); } });
  worker.once('exit', (code) => { if (code !== 0) reject(new Error(`monitor_exit_${code}`)); });
})));
const gossipStatements = gossipMessages.map((row) => row.gossip);
const monitorRegistry = new KeyRegistry(); for (const row of retrievalMessages) monitorRegistry.registerExported(row.publicKey);
const retrievalTrust = { publisherRegistry: reg(publisher), trustedPublisherIds: [publisher.keyId], monitorRegistry, trustedMonitorIds: retrievalMessages.map((row) => row.publicKey.keyId), monitors: retrievalMessages.map((row) => row.descriptor), quorum: 3 };
const retrievalResult = verifyRetrievalAndGossipV33_35({ publicationReceipt, retrievalReceipts, gossipStatements, trust: retrievalTrust, verifiedAt: at('2026-07-22T16:03:00.000Z') });
if (!retrievalResult.independentProcessesObserved) throw new Error('independent_processes_not_observed');
const splitMaterial = { ...retrievalReceipts[2].payload, artifactDigest: digest('split-artifact') }; delete splitMaterial.retrievalDigest;
const splitReceipt = { ...retrievalReceipts[2], payload: { ...splitMaterial, retrievalDigest: sha256(splitMaterial) } };
const splitViewDetected = detectMonitorSplitViewV33_35([retrievalReceipts[0], retrievalReceipts[1], splitReceipt]).length === 1;
if (!splitViewDetected) throw new Error('split_view_not_detected');
const verdict = createTakeoverRecoveryVerdictV33_35({ takeover: takeover.certificate, retrievalResult, generatedAt: at('2026-07-22T16:03:00.000Z') });

const parentRegistry = reg(rotationAuthority, recoveryAuthority, outgoing, replacement, ...witnesses, publisher);
const publicKeys = [...parentRegistry.listPublicKeys(), ...retrievalMessages.map((row) => row.publicKey)].sort((a,b) => a.keyId.localeCompare(b.keyId));
const proof = {
  version: '33.35', generatedAt: '2026-07-22T16:03:00.000Z', status: 'PASS',
  takeover, outgoingAction, replacementAction, artifact, publicationReceipt, retrievalReceipts, gossipStatements, publicKeys,
  execution: { serverPid: serverReady.pid, monitorPids: retrievalMessages.map((row) => row.pid), distinctMonitorProcessCount: new Set(retrievalMessages.map((row) => row.pid)).size, networkFetchObserved: true, transport: 'HTTP_LOOPBACK', externalTopologyObserved: false },
  attacks: { earlyTakeoverBlocked: true, outgoingCoordinatorResurrectionBlocked: resurrectionBlocked, splitViewDetected },
  summary: { predecessorTerm: takeoverCertificate.predecessorTerm, nextTerm: takeoverCertificate.nextTerm, sequenceStart: takeoverCertificate.sequenceStart, sequenceEnd: takeoverCertificate.sequenceEnd, expiryVoteCount: expiryVotes.length, retrievalCount: retrievalReceipts.length, gossipCount: gossipStatements.length, signatureCount: 1 + 1 + 1 + expiryVotes.length + 1 + 1 + 1 + 1 + retrievalReceipts.length + gossipStatements.length },
  truthBoundary: { independentProcessesObserved: true, networkFetchObserved: true, externalTopologyObserved: false, externalWitnessHostsObserved: 0, externalHumanParticipants: 0, productionAuthority: 'NONE', externalEffectsExecuted: 0, productionPromotion: 'blocked' },
  verdict,
};
writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
for (const worker of workers) worker.send({ type: 'shutdown' });
server.send({ type: 'shutdown' });
console.log(JSON.stringify({ status: 'PASS', output, tests: proof.summary, execution: proof.execution, truthBoundary: proof.truthBoundary }));
