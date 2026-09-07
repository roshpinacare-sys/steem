import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { KeyRegistry } from '../dist/src/contracts/crypto.js';
import {
  verifyCoordinatorActionAgainstTakeoverV33_35,
  verifyExpiredCoordinatorTakeoverV33_35,
  verifyRetrievalAndGossipV33_35,
} from '../dist/src/app/expired-coordinator-takeover-v33_35.js';
const input = resolve(process.argv[2] ?? 'release-evidence/v33.35/V33_35_EXPIRED_TAKEOVER_PROOF.json');
const output = resolve(process.argv[3] ?? 'release-evidence/v33.35/V33_35_INDEPENDENT_VERIFICATION.json');
const proof = JSON.parse(readFileSync(input, 'utf8'));
const registry = new KeyRegistry(); for (const key of proof.publicKeys) registry.registerExported(key);
const verifiedAt = new Date(proof.generatedAt);
const takeover = proof.takeover;
const trust = {
  predecessorLeaseRegistry: registry, trustedPredecessorLeaseSignerIds: [takeover.predecessorLease.issuerKeyId],
  planRegistry: registry, trustedPlanSignerIds: [takeover.plan.issuerKeyId],
  replacementCoordinatorRegistry: registry, trustedReplacementCoordinatorIds: [takeover.acceptance.issuerKeyId],
  witnessRegistry: registry, trustedWitnessIds: takeover.expiryVotes.map((row) => row.issuerKeyId),
  recoveryAuthorityRegistry: registry, trustedRecoveryAuthorityIds: [takeover.certificate.issuerKeyId],
};
const certificate = verifyExpiredCoordinatorTakeoverV33_35({ bundle: takeover, trust, verifiedAt });
let resurrectionBlocked = false;
try { verifyCoordinatorActionAgainstTakeoverV33_35({ action: proof.outgoingAction, coordinatorRegistry: registry, takeover: takeover.certificate, verifiedAt }); }
catch (error) { resurrectionBlocked = /v33_35_outgoing_coordinator_fenced/.test(String(error)); }
if (!resurrectionBlocked) throw new Error('independent_resurrection_check_failed');
verifyCoordinatorActionAgainstTakeoverV33_35({ action: proof.replacementAction, coordinatorRegistry: registry, takeover: takeover.certificate, verifiedAt });
const monitorIds = proof.retrievalReceipts.map((row) => row.issuerKeyId);
const monitors = proof.retrievalReceipts.map((row) => ({ witnessId: row.payload.monitorId, keyId: row.payload.monitorKeyId, keyFingerprint: registry.fingerprint(row.payload.monitorKeyId), organizationId: row.payload.monitorOrganizationId, hostId: row.payload.monitorHostId }));
const retrieval = verifyRetrievalAndGossipV33_35({
  publicationReceipt: proof.publicationReceipt,
  retrievalReceipts: proof.retrievalReceipts,
  gossipStatements: proof.gossipStatements,
  trust: { publisherRegistry: registry, trustedPublisherIds: [proof.publicationReceipt.issuerKeyId], monitorRegistry: registry, trustedMonitorIds: monitorIds, monitors, quorum: 3 },
  verifiedAt,
});
const signatureCount = 1 + 1 + 1 + takeover.expiryVotes.length + 1 + 1 + 1 + 1 + proof.retrievalReceipts.length + proof.gossipStatements.length;
const checks = {
  takeoverVerified: certificate.takeoverDigest === proof.verdict.takeoverDigest,
  outgoingSignatureNotRequired: proof.verdict.outgoingCoordinatorSignatureRequired === false,
  resurrectionBlocked,
  sequenceContinuous: certificate.sequenceStart === takeover.predecessorLease.payload.sequenceEnd + 1,
  termAdvanced: certificate.nextTerm === certificate.predecessorTerm + 1,
  retrievalQuorumVerified: retrieval.retrievals.length === 3,
  gossipQuorumVerified: retrieval.gossip.length === 3,
  independentProcessesObserved: retrieval.independentProcessesObserved && new Set(proof.execution.monitorPids).size === 3,
  networkFetchObserved: proof.execution.networkFetchObserved === true,
  externalTopologyNotClaimed: proof.execution.externalTopologyObserved === false && retrieval.externalTopologyObserved === false,
  productionBlocked: proof.truthBoundary.productionAuthority === 'NONE' && proof.truthBoundary.externalEffectsExecuted === 0 && proof.truthBoundary.productionPromotion === 'blocked',
  externalHumansZero: proof.truthBoundary.externalHumanParticipants === 0,
};
const status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
const report = { version: '33.35', generatedAt: new Date().toISOString(), status, signatureCount, predecessorTerm: certificate.predecessorTerm, nextTerm: certificate.nextTerm, sequenceStart: certificate.sequenceStart, sequenceEnd: certificate.sequenceEnd, distinctMonitorProcessCount: new Set(proof.execution.monitorPids).size, networkFetchObserved: true, externalTopologyObserved: false, externalHumanParticipants: 0, productionAuthority: 'NONE', checks };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (status !== 'PASS') process.exit(1);
