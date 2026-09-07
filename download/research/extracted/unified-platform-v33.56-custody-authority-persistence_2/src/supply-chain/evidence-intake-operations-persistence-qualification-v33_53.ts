import { KeyRegistry, sha256, sha256Bytes, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { AuditReplayVerdictPayloadV33_52 } from './evidence-intake-operations-persistence-v33_52.js';

export type QualificationTopologyV33_53 = 'LOCAL_MULTI_PROCESS_REHEARSAL' | 'INDEPENDENT_EXTERNAL_ATTESTED';
export interface InfrastructureActorV33_53 {
  readonly keyId: string;
  readonly organizationId: string;
  readonly administratorId: string;
  readonly hostId: string;
  readonly siteId: string;
  readonly providerId: string;
}
export interface QualificationPolicyPayloadV33_53 {
  readonly version: '33.53';
  readonly qualificationId: string;
  readonly baseAuditVerdictDigest: string;
  readonly authority: InfrastructureActorV33_53;
  readonly requiredStoreCount: 3;
  readonly requiredWorkerCount: 2;
  readonly requiredClockCount: 2;
  readonly partitionObserverQuorum: 2;
  readonly minimumPartitionMs: number;
  readonly maximumClockSkewMs: number;
  readonly overloadHighWatermark: number;
  readonly overloadLowWatermark: number;
  readonly requiredRejectedOperations: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly policyDigest: string;
}
export interface InfrastructureAttestationPayloadV33_53 {
  readonly version: '33.53';
  readonly qualificationId: string;
  readonly policyDigest: string;
  readonly role: 'QUEUE_STORE' | 'WORKER_HOST';
  readonly actor: InfrastructureActorV33_53;
  readonly endpoint: string;
  readonly appendOnly: boolean;
  readonly processIsolation: true;
  readonly topology: QualificationTopologyV33_53;
  readonly externalEvidenceDigest: string | null;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly attestationDigest: string;
}
export interface LeaseClockAttestationPayloadV33_53 {
  readonly version: '33.53';
  readonly qualificationId: string;
  readonly policyDigest: string;
  readonly source: InfrastructureActorV33_53;
  readonly unixTimeMs: number;
  readonly maximumErrorMs: number;
  readonly topology: QualificationTopologyV33_53;
  readonly externalEvidenceDigest: string | null;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly clockDigest: string;
}
export interface QueueStoreReceiptPayloadV33_53 {
  readonly version: '33.53';
  readonly qualificationId: string;
  readonly policyDigest: string;
  readonly baseAuditVerdictDigest: string;
  readonly phase: 'INITIAL' | 'POST_FAILOVER';
  readonly replicationEpoch: number;
  readonly coordinatorTerm: number;
  readonly coordinatorKeyId: string;
  readonly store: InfrastructureActorV33_53;
  readonly processId: number;
  readonly journalEntryCount: number;
  readonly journalHeadDigest: string;
  readonly exactBytesDigest: string;
  readonly exactByteLength: number;
  readonly fileFsync: true;
  readonly directoryFsync: true;
  readonly readBackDigest: string;
  readonly durableAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}
export interface PartitionObservationPayloadV33_53 {
  readonly version: '33.53';
  readonly qualificationId: string;
  readonly policyDigest: string;
  readonly partitionId: string;
  readonly predecessorWorker: InfrastructureActorV33_53;
  readonly observer: InfrastructureActorV33_53;
  readonly journalHeadDigest: string;
  readonly partitionStartedAt: string;
  readonly observedAt: string;
  readonly decision: 'PREDECESSOR_UNREACHABLE';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly observationDigest: string;
}
export interface PartitionFailoverCertificatePayloadV33_53 {
  readonly version: '33.53';
  readonly qualificationId: string;
  readonly policyDigest: string;
  readonly predecessorWorker: InfrastructureActorV33_53;
  readonly successorWorker: InfrastructureActorV33_53;
  readonly predecessorTerm: number;
  readonly successorTerm: number;
  readonly fenceSequence: number;
  readonly journalHeadDigest: string;
  readonly observationDigests: readonly string[];
  readonly clockDigests: readonly string[];
  readonly effectiveAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly failoverDigest: string;
}
export interface OverloadDrillReceiptPayloadV33_53 {
  readonly version: '33.53';
  readonly qualificationId: string;
  readonly policyDigest: string;
  readonly worker: InfrastructureActorV33_53;
  readonly processId: number;
  readonly attemptedOperations: number;
  readonly acceptedOperations: number;
  readonly rejectedOperations: number;
  readonly highWatermark: number;
  readonly lowWatermark: number;
  readonly pressureActivated: true;
  readonly hysteresisHeld: true;
  readonly drainedBacklogCount: number;
  readonly pressureCleared: true;
  readonly metricsDigest: string;
  readonly executedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}
export interface SiteLossAuditReplayReceiptPayloadV33_53 {
  readonly version: '33.53';
  readonly qualificationId: string;
  readonly policyDigest: string;
  readonly lostSiteId: string;
  readonly recoveryActor: InfrastructureActorV33_53;
  readonly processId: number;
  readonly sourceStoreReceiptDigests: readonly string[];
  readonly restoredJournalHeadDigest: string;
  readonly restoredBytesDigest: string;
  readonly restoredByteLength: number;
  readonly restoredEntryCount: number;
  readonly auditReplayDigest: string;
  readonly fileFsync: true;
  readonly directoryFsync: true;
  readonly readBackDigest: string;
  readonly noGap: true;
  readonly noFork: true;
  readonly recoveredAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly recoveryDigest: string;
}
export interface PersistenceInfrastructureQualificationVerdictPayloadV33_53 {
  readonly version: '33.53';
  readonly status: 'LOCAL_PERSISTENCE_INFRASTRUCTURE_QUALIFICATION_REHEARSAL_ONLY' | 'EXTERNAL_PERSISTENCE_INFRASTRUCTURE_QUALIFIED';
  readonly qualificationId: string;
  readonly policyDigest: string;
  readonly baseAuditVerdictDigest: string;
  readonly storeAttestationDigests: readonly string[];
  readonly workerAttestationDigests: readonly string[];
  readonly clockDigests: readonly string[];
  readonly initialStoreReceiptDigests: readonly string[];
  readonly failoverDigest: string;
  readonly postFailoverStoreReceiptDigests: readonly string[];
  readonly overloadReceiptDigests: readonly string[];
  readonly recoveryDigest: string;
  readonly distinctStoreProcesses: 3;
  readonly distinctWorkerProcesses: 2;
  readonly independentClockQuorumVerified: true;
  readonly partitionFailoverVerified: true;
  readonly overloadBackpressureVerified: true;
  readonly siteLossAuditReplayVerified: true;
  readonly exactByteReplicationVerified: true;
  readonly externalTopologyObserved: boolean;
  readonly externalInfrastructureAttestations: number;
  readonly externalHumanParticipants: 0;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verifiedAt: string;
  readonly verdictDigest: string;
}
export interface PersistenceInfrastructureQualificationTrustV33_53 {
  readonly policyRegistry: KeyRegistry; readonly trustedPolicySignerIds: readonly string[];
  readonly infrastructureRegistry: KeyRegistry; readonly trustedInfrastructureSignerIds: readonly string[];
  readonly clockRegistry: KeyRegistry; readonly trustedClockSignerIds: readonly string[];
  readonly storeRegistry: KeyRegistry; readonly trustedStoreSignerIds: readonly string[];
  readonly partitionRegistry: KeyRegistry; readonly trustedPartitionSignerIds: readonly string[];
  readonly failoverRegistry: KeyRegistry; readonly trustedFailoverSignerIds: readonly string[];
  readonly overloadRegistry: KeyRegistry; readonly trustedOverloadSignerIds: readonly string[];
  readonly recoveryRegistry: KeyRegistry; readonly trustedRecoverySignerIds: readonly string[];
  readonly verdictRegistry: KeyRegistry; readonly trustedVerdictSignerIds: readonly string[];
  readonly baseAuditRegistry: KeyRegistry; readonly trustedBaseAuditSignerIds: readonly string[];
  readonly trustedExternalEvidenceDigests: readonly string[];
}

const HEX64=/^[0-9a-f]{64}$/;
const digestWithout=<T extends Record<string,unknown>>(payload:T,key:keyof T)=>{const copy={...payload};delete copy[key];return sha256(copy);};
const assertDigest=(payload:Record<string,unknown>,key:string,code:string)=>{const v=payload[key];if(typeof v!=='string'||!HEX64.test(v)||digestWithout(payload,key)!==v)throw new Error(code);};
const requireDigest=(v:string,code:string)=>{if(!HEX64.test(v))throw new Error(code);};
const verifyEnvelope=<T>(env:SignedEnvelope<T>,registry:KeyRegistry,ids:readonly string[],at:Date,code:string)=>{if(!ids.includes(env.issuerKeyId)||!registry.verifyAt(env,at))throw new Error(code);};
const parseTime=(v:string,code:string)=>{const n=Date.parse(v);if(!Number.isFinite(n))throw new Error(code);return n;};
const assertActor=(a:InfrastructureActorV33_53,code:string)=>{if(Object.values(a).some(v=>typeof v!=='string'||v.trim()===''))throw new Error(code);};
const actorKey=(a:InfrastructureActorV33_53)=>`${a.keyId}|${a.organizationId}|${a.administratorId}|${a.hostId}|${a.siteId}|${a.providerId}`;
const distinctActors=(actors:readonly InfrastructureActorV33_53[],code:string)=>{for(const f of ['keyId','organizationId','administratorId','hostId','siteId','providerId'] as const){if(new Set(actors.map(a=>a[f])).size!==actors.length)throw new Error(code);}};
const isPublicEndpoint=(endpoint:string)=>/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/|$)/i.test(endpoint)&&!/(localhost|\.local(?:\/|$)|\.invalid(?:\/|$)|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)/i.test(endpoint);

export function createQualificationPolicyV33_53(input:{signer:SigningIdentity;qualificationId:string;authority:InfrastructureActorV33_53;baseAuditVerdict:SignedEnvelope<AuditReplayVerdictPayloadV33_52>;issuedAt:Date;expiresAt:Date;minimumPartitionMs?:number;maximumClockSkewMs?:number;overloadHighWatermark?:number;overloadLowWatermark?:number;requiredRejectedOperations?:number}){
  assertActor(input.authority,'qualification_policy_actor');
  if(input.qualificationId.trim()===''||input.expiresAt<=input.issuedAt)throw new Error('qualification_policy_input');
  const high=input.overloadHighWatermark??8,low=input.overloadLowWatermark??3;
  if(high<2||low<0||low>=high)throw new Error('qualification_pressure_policy');
  const m={version:'33.53' as const,qualificationId:input.qualificationId,baseAuditVerdictDigest:input.baseAuditVerdict.payload.verdictDigest,authority:input.authority,requiredStoreCount:3 as const,requiredWorkerCount:2 as const,requiredClockCount:2 as const,partitionObserverQuorum:2 as const,minimumPartitionMs:input.minimumPartitionMs??5000,maximumClockSkewMs:input.maximumClockSkewMs??250,overloadHighWatermark:high,overloadLowWatermark:low,requiredRejectedOperations:input.requiredRejectedOperations??3,issuedAt:input.issuedAt.toISOString(),expiresAt:input.expiresAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,policyDigest:sha256(m)},input.signer);
}
export function createInfrastructureAttestationV33_53(input:{signer:SigningIdentity;policy:SignedEnvelope<QualificationPolicyPayloadV33_53>;role:'QUEUE_STORE'|'WORKER_HOST';actor:InfrastructureActorV33_53;endpoint:string;appendOnly:boolean;topology:QualificationTopologyV33_53;externalEvidenceDigest:string|null;observedAt:Date}){
  assertActor(input.actor,'infrastructure_actor');
  if(input.endpoint.trim()===''||input.signer.keyId!==input.actor.keyId)throw new Error('infrastructure_binding');
  if(input.role==='QUEUE_STORE'&&!input.appendOnly)throw new Error('store_append_only_required');
  if(input.topology==='INDEPENDENT_EXTERNAL_ATTESTED'&&(input.externalEvidenceDigest===null||!isPublicEndpoint(input.endpoint)))throw new Error('external_infrastructure_evidence_required');
  if(input.externalEvidenceDigest!==null)requireDigest(input.externalEvidenceDigest,'infrastructure_evidence_digest');
  const m={version:'33.53' as const,qualificationId:input.policy.payload.qualificationId,policyDigest:input.policy.payload.policyDigest,role:input.role,actor:input.actor,endpoint:input.endpoint,appendOnly:input.appendOnly,processIsolation:true as const,topology:input.topology,externalEvidenceDigest:input.externalEvidenceDigest,observedAt:input.observedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,attestationDigest:sha256(m)},input.signer);
}
export function createLeaseClockAttestationV33_53(input:{signer:SigningIdentity;policy:SignedEnvelope<QualificationPolicyPayloadV33_53>;source:InfrastructureActorV33_53;unixTimeMs:number;maximumErrorMs:number;topology:QualificationTopologyV33_53;externalEvidenceDigest:string|null;observedAt:Date}){
  assertActor(input.source,'clock_actor'); if(input.signer.keyId!==input.source.keyId||!Number.isInteger(input.unixTimeMs)||input.maximumErrorMs<0)throw new Error('clock_input');
  if(input.topology==='INDEPENDENT_EXTERNAL_ATTESTED'&&input.externalEvidenceDigest===null)throw new Error('external_clock_evidence_required');
  if(input.externalEvidenceDigest!==null)requireDigest(input.externalEvidenceDigest,'clock_evidence_digest');
  const m={version:'33.53' as const,qualificationId:input.policy.payload.qualificationId,policyDigest:input.policy.payload.policyDigest,source:input.source,unixTimeMs:input.unixTimeMs,maximumErrorMs:input.maximumErrorMs,topology:input.topology,externalEvidenceDigest:input.externalEvidenceDigest,observedAt:input.observedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,clockDigest:sha256(m)},input.signer);
}
export function createQueueStoreReceiptV33_53(input:{signer:SigningIdentity;policy:SignedEnvelope<QualificationPolicyPayloadV33_53>;baseAuditVerdict:SignedEnvelope<AuditReplayVerdictPayloadV33_52>;phase:'INITIAL'|'POST_FAILOVER';replicationEpoch:number;coordinatorTerm:number;coordinatorKeyId:string;store:InfrastructureActorV33_53;processId:number;journalEntryCount:number;journalHeadDigest:string;exactBytes:Uint8Array;readBackBytes:Uint8Array;durableAt:Date}){
  assertActor(input.store,'store_actor'); requireDigest(input.journalHeadDigest,'store_head_digest');
  if(input.signer.keyId!==input.store.keyId||input.processId<1||input.journalEntryCount<1||input.replicationEpoch<1||input.coordinatorTerm<1)throw new Error('store_receipt_input');
  const exactBytesDigest=sha256Bytes(input.exactBytes),readBackDigest=sha256Bytes(input.readBackBytes); if(exactBytesDigest!==readBackDigest||input.exactBytes.byteLength!==input.readBackBytes.byteLength)throw new Error('store_readback');
  const m={version:'33.53' as const,qualificationId:input.policy.payload.qualificationId,policyDigest:input.policy.payload.policyDigest,baseAuditVerdictDigest:input.baseAuditVerdict.payload.verdictDigest,phase:input.phase,replicationEpoch:input.replicationEpoch,coordinatorTerm:input.coordinatorTerm,coordinatorKeyId:input.coordinatorKeyId,store:input.store,processId:input.processId,journalEntryCount:input.journalEntryCount,journalHeadDigest:input.journalHeadDigest,exactBytesDigest,exactByteLength:input.exactBytes.byteLength,fileFsync:true as const,directoryFsync:true as const,readBackDigest,durableAt:input.durableAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,receiptDigest:sha256(m)},input.signer);
}
export function createPartitionObservationV33_53(input:{signer:SigningIdentity;policy:SignedEnvelope<QualificationPolicyPayloadV33_53>;partitionId:string;predecessorWorker:InfrastructureActorV33_53;observer:InfrastructureActorV33_53;journalHeadDigest:string;partitionStartedAt:Date;observedAt:Date}){
  assertActor(input.predecessorWorker,'partition_predecessor');assertActor(input.observer,'partition_observer');requireDigest(input.journalHeadDigest,'partition_head');
  if(input.signer.keyId!==input.observer.keyId||input.partitionId.trim()===''||actorKey(input.predecessorWorker)===actorKey(input.observer)||input.observedAt.getTime()-input.partitionStartedAt.getTime()<input.policy.payload.minimumPartitionMs)throw new Error('partition_observation_input');
  const m={version:'33.53' as const,qualificationId:input.policy.payload.qualificationId,policyDigest:input.policy.payload.policyDigest,partitionId:input.partitionId,predecessorWorker:input.predecessorWorker,observer:input.observer,journalHeadDigest:input.journalHeadDigest,partitionStartedAt:input.partitionStartedAt.toISOString(),observedAt:input.observedAt.toISOString(),decision:'PREDECESSOR_UNREACHABLE' as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,observationDigest:sha256(m)},input.signer);
}
export function createPartitionFailoverCertificateV33_53(input:{signer:SigningIdentity;policy:SignedEnvelope<QualificationPolicyPayloadV33_53>;predecessorWorker:InfrastructureActorV33_53;successorWorker:InfrastructureActorV33_53;predecessorTerm:number;successorTerm:number;fenceSequence:number;journalHeadDigest:string;observations:readonly SignedEnvelope<PartitionObservationPayloadV33_53>[];clocks:readonly SignedEnvelope<LeaseClockAttestationPayloadV33_53>[];effectiveAt:Date}){
  requireDigest(input.journalHeadDigest,'failover_head');
  if(input.successorTerm!==input.predecessorTerm+1||input.fenceSequence<1||actorKey(input.predecessorWorker)===actorKey(input.successorWorker)||input.observations.length!==2||input.clocks.length<2)throw new Error('failover_input');
  const obs=[...input.observations.map(x=>x.payload.observationDigest)].sort(),clocks=[...input.clocks.map(x=>x.payload.clockDigest)].sort();
  const m={version:'33.53' as const,qualificationId:input.policy.payload.qualificationId,policyDigest:input.policy.payload.policyDigest,predecessorWorker:input.predecessorWorker,successorWorker:input.successorWorker,predecessorTerm:input.predecessorTerm,successorTerm:input.successorTerm,fenceSequence:input.fenceSequence,journalHeadDigest:input.journalHeadDigest,observationDigests:obs,clockDigests:clocks,effectiveAt:input.effectiveAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,failoverDigest:sha256(m)},input.signer);
}
export function createOverloadDrillReceiptV33_53(input:{signer:SigningIdentity;policy:SignedEnvelope<QualificationPolicyPayloadV33_53>;worker:InfrastructureActorV33_53;processId:number;attemptedOperations:number;acceptedOperations:number;rejectedOperations:number;drainedBacklogCount:number;executedAt:Date}){
  assertActor(input.worker,'overload_worker');
  if(input.signer.keyId!==input.worker.keyId||input.processId<1||input.attemptedOperations!==input.acceptedOperations+input.rejectedOperations||input.acceptedOperations>input.policy.payload.overloadHighWatermark||input.rejectedOperations<input.policy.payload.requiredRejectedOperations||input.drainedBacklogCount>input.policy.payload.overloadLowWatermark)throw new Error('overload_contract');
  const metrics={attemptedOperations:input.attemptedOperations,acceptedOperations:input.acceptedOperations,rejectedOperations:input.rejectedOperations,drainedBacklogCount:input.drainedBacklogCount};
  const m={version:'33.53' as const,qualificationId:input.policy.payload.qualificationId,policyDigest:input.policy.payload.policyDigest,worker:input.worker,processId:input.processId,attemptedOperations:input.attemptedOperations,acceptedOperations:input.acceptedOperations,rejectedOperations:input.rejectedOperations,highWatermark:input.policy.payload.overloadHighWatermark,lowWatermark:input.policy.payload.overloadLowWatermark,pressureActivated:true as const,hysteresisHeld:true as const,drainedBacklogCount:input.drainedBacklogCount,pressureCleared:true as const,metricsDigest:sha256(metrics),executedAt:input.executedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,receiptDigest:sha256(m)},input.signer);
}
export function createSiteLossAuditReplayReceiptV33_53(input:{signer:SigningIdentity;policy:SignedEnvelope<QualificationPolicyPayloadV33_53>;lostSiteId:string;recoveryActor:InfrastructureActorV33_53;processId:number;sourceStoreReceipts:readonly SignedEnvelope<QueueStoreReceiptPayloadV33_53>[];restoredJournalHeadDigest:string;restoredBytes:Uint8Array;readBackBytes:Uint8Array;restoredEntryCount:number;auditReplayDigest:string;recoveredAt:Date}){
  assertActor(input.recoveryActor,'recovery_actor');requireDigest(input.restoredJournalHeadDigest,'recovery_head');requireDigest(input.auditReplayDigest,'recovery_audit_digest');
  if(input.signer.keyId!==input.recoveryActor.keyId||input.processId<1||input.sourceStoreReceipts.length!==2||new Set(input.sourceStoreReceipts.map(x=>x.payload.store.siteId)).size!==2||input.sourceStoreReceipts.some(x=>x.payload.store.siteId===input.lostSiteId)||input.recoveryActor.siteId===input.lostSiteId)throw new Error('recovery_input');
  const restoredBytesDigest=sha256Bytes(input.restoredBytes),readBackDigest=sha256Bytes(input.readBackBytes);if(restoredBytesDigest!==readBackDigest||input.restoredBytes.byteLength!==input.readBackBytes.byteLength)throw new Error('recovery_readback');
  const m={version:'33.53' as const,qualificationId:input.policy.payload.qualificationId,policyDigest:input.policy.payload.policyDigest,lostSiteId:input.lostSiteId,recoveryActor:input.recoveryActor,processId:input.processId,sourceStoreReceiptDigests:input.sourceStoreReceipts.map(x=>x.payload.receiptDigest).sort(),restoredJournalHeadDigest:input.restoredJournalHeadDigest,restoredBytesDigest,restoredByteLength:input.restoredBytes.byteLength,restoredEntryCount:input.restoredEntryCount,auditReplayDigest:input.auditReplayDigest,fileFsync:true as const,directoryFsync:true as const,readBackDigest,noGap:true as const,noFork:true as const,recoveredAt:input.recoveredAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,recoveryDigest:sha256(m)},input.signer);
}
export function qualifyPersistenceInfrastructureV33_53(input:{signer:SigningIdentity;policy:SignedEnvelope<QualificationPolicyPayloadV33_53>;baseAuditVerdict:SignedEnvelope<AuditReplayVerdictPayloadV33_52>;storeAttestations:readonly SignedEnvelope<InfrastructureAttestationPayloadV33_53>[];workerAttestations:readonly SignedEnvelope<InfrastructureAttestationPayloadV33_53>[];clockAttestations:readonly SignedEnvelope<LeaseClockAttestationPayloadV33_53>[];initialStoreReceipts:readonly SignedEnvelope<QueueStoreReceiptPayloadV33_53>[];partitionObservations:readonly SignedEnvelope<PartitionObservationPayloadV33_53>[];failover:SignedEnvelope<PartitionFailoverCertificatePayloadV33_53>;postFailoverStoreReceipts:readonly SignedEnvelope<QueueStoreReceiptPayloadV33_53>[];overloadReceipts:readonly SignedEnvelope<OverloadDrillReceiptPayloadV33_53>[];recovery:SignedEnvelope<SiteLossAuditReplayReceiptPayloadV33_53>;trust:PersistenceInfrastructureQualificationTrustV33_53;verifiedAt:Date}){
  const at=input.verifiedAt;verifyEnvelope(input.policy,input.trust.policyRegistry,input.trust.trustedPolicySignerIds,at,'policy_signature');assertDigest(input.policy.payload as unknown as Record<string,unknown>,'policyDigest','policy_digest');
  if(at.getTime()>parseTime(input.policy.payload.expiresAt,'policy_expiry'))throw new Error('policy_expired');
  verifyEnvelope(input.baseAuditVerdict,input.trust.baseAuditRegistry,input.trust.trustedBaseAuditSignerIds,at,'base_audit_signature');assertDigest(input.baseAuditVerdict.payload as unknown as Record<string,unknown>,'verdictDigest','base_audit_digest');
  if(input.baseAuditVerdict.payload.verdictDigest!==input.policy.payload.baseAuditVerdictDigest)throw new Error('base_audit_binding');
  const verifyAtts=(items:readonly SignedEnvelope<InfrastructureAttestationPayloadV33_53>[],role:'QUEUE_STORE'|'WORKER_HOST',count:number)=>{if(items.length!==count)throw new Error(`${role.toLowerCase()}_attestation_count`);const actors:InfrastructureActorV33_53[]=[];for(const a of items){verifyEnvelope(a,input.trust.infrastructureRegistry,input.trust.trustedInfrastructureSignerIds,at,'infrastructure_signature');assertDigest(a.payload as unknown as Record<string,unknown>,'attestationDigest','infrastructure_digest');if(a.issuerKeyId!==a.payload.actor.keyId||a.payload.role!==role||a.payload.policyDigest!==input.policy.payload.policyDigest||!a.payload.processIsolation||a.payload.productionAuthority!=='NONE'||a.payload.externalEffectsExecuted!==0)throw new Error('infrastructure_contract');if(role==='QUEUE_STORE'&&!a.payload.appendOnly)throw new Error('store_append_only');actors.push(a.payload.actor);}distinctActors(actors,`${role.toLowerCase()}_separation`);return actors;};
  const stores=verifyAtts(input.storeAttestations,'QUEUE_STORE',3),workers=verifyAtts(input.workerAttestations,'WORKER_HOST',2);distinctActors([...stores,...workers],'store_worker_separation');
  if(input.clockAttestations.length!==2)throw new Error('clock_count');const clockActors:InfrastructureActorV33_53[]=[],clockTimes:number[]=[];for(const c of input.clockAttestations){verifyEnvelope(c,input.trust.clockRegistry,input.trust.trustedClockSignerIds,at,'clock_signature');assertDigest(c.payload as unknown as Record<string,unknown>,'clockDigest','clock_digest');if(c.issuerKeyId!==c.payload.source.keyId||c.payload.policyDigest!==input.policy.payload.policyDigest||c.payload.maximumErrorMs>input.policy.payload.maximumClockSkewMs||c.payload.productionAuthority!=='NONE'||c.payload.externalEffectsExecuted!==0)throw new Error('clock_contract');clockActors.push(c.payload.source);clockTimes.push(c.payload.unixTimeMs);}distinctActors(clockActors,'clock_separation');if(Math.max(...clockTimes)-Math.min(...clockTimes)>input.policy.payload.maximumClockSkewMs)throw new Error('clock_skew');
  const storeByKey=new Map(stores.map(x=>[actorKey(x),x]));const verifyStoreSet=(items:readonly SignedEnvelope<QueueStoreReceiptPayloadV33_53>[],phase:'INITIAL'|'POST_FAILOVER',epoch:number,term:number,coordinatorKeyId:string)=>{if(items.length!==3)throw new Error('store_receipt_count');const pids=new Set<number>(),digests=new Set<string>(),actors:InfrastructureActorV33_53[]=[];for(const r of items){verifyEnvelope(r,input.trust.storeRegistry,input.trust.trustedStoreSignerIds,at,'store_receipt_signature');assertDigest(r.payload as unknown as Record<string,unknown>,'receiptDigest','store_receipt_digest');if(r.issuerKeyId!==r.payload.store.keyId||!storeByKey.has(actorKey(r.payload.store))||r.payload.phase!==phase||r.payload.replicationEpoch!==epoch||r.payload.coordinatorTerm!==term||r.payload.coordinatorKeyId!==coordinatorKeyId||r.payload.policyDigest!==input.policy.payload.policyDigest||r.payload.baseAuditVerdictDigest!==input.baseAuditVerdict.payload.verdictDigest||r.payload.journalEntryCount!==input.baseAuditVerdict.payload.journalEntryCount||r.payload.journalHeadDigest!==input.baseAuditVerdict.payload.journalHeadDigest||r.payload.readBackDigest!==r.payload.exactBytesDigest||!r.payload.fileFsync||!r.payload.directoryFsync)throw new Error('store_receipt_contract');pids.add(r.payload.processId);digests.add(r.payload.receiptDigest);actors.push(r.payload.store);}distinctActors(actors,'store_receipt_separation');if(pids.size!==3||digests.size!==3)throw new Error('store_process_collision');const first=items[0]!.payload;if(items.some(r=>r.payload.exactBytesDigest!==first.exactBytesDigest||r.payload.exactByteLength!==first.exactByteLength||r.payload.journalHeadDigest!==first.journalHeadDigest))throw new Error('store_split_view');return first;};
  const predecessor=workers[0]!,successor=workers[1]!;const initial=verifyStoreSet(input.initialStoreReceipts,'INITIAL',1,2,predecessor.keyId);
  if(input.partitionObservations.length!==2)throw new Error('partition_quorum');const observers:InfrastructureActorV33_53[]=[],obsDigests=new Set<string>();let partitionId:string|undefined,latest=0;for(const o of input.partitionObservations){verifyEnvelope(o,input.trust.partitionRegistry,input.trust.trustedPartitionSignerIds,at,'partition_signature');assertDigest(o.payload as unknown as Record<string,unknown>,'observationDigest','partition_digest');if(o.issuerKeyId!==o.payload.observer.keyId||actorKey(o.payload.predecessorWorker)!==actorKey(predecessor)||o.payload.journalHeadDigest!==input.baseAuditVerdict.payload.journalHeadDigest||parseTime(o.payload.observedAt,'partition_observed')-parseTime(o.payload.partitionStartedAt,'partition_started')<input.policy.payload.minimumPartitionMs)throw new Error('partition_contract');if(partitionId&&partitionId!==o.payload.partitionId)throw new Error('partition_id');partitionId=o.payload.partitionId;latest=Math.max(latest,parseTime(o.payload.observedAt,'partition_observed'));observers.push(o.payload.observer);obsDigests.add(o.payload.observationDigest);}distinctActors(observers,'partition_observer_separation');if(obsDigests.size!==2)throw new Error('partition_duplicate');
  verifyEnvelope(input.failover,input.trust.failoverRegistry,input.trust.trustedFailoverSignerIds,at,'failover_signature');assertDigest(input.failover.payload as unknown as Record<string,unknown>,'failoverDigest','failover_digest');const f=input.failover.payload;if(actorKey(f.predecessorWorker)!==actorKey(predecessor)||actorKey(f.successorWorker)!==actorKey(successor)||f.predecessorTerm!==2||f.successorTerm!==3||f.fenceSequence!==input.baseAuditVerdict.payload.journalEntryCount+1||f.journalHeadDigest!==input.baseAuditVerdict.payload.journalHeadDigest||JSON.stringify(f.observationDigests)!==JSON.stringify([...obsDigests].sort())||JSON.stringify(f.clockDigests)!==JSON.stringify(input.clockAttestations.map(c=>c.payload.clockDigest).sort())||parseTime(f.effectiveAt,'failover_time')<latest)throw new Error('failover_contract');
  const post=verifyStoreSet(input.postFailoverStoreReceipts,'POST_FAILOVER',2,3,successor.keyId);if(post.exactBytesDigest!==initial.exactBytesDigest||post.exactByteLength!==initial.exactByteLength)throw new Error('post_failover_bytes');
  if(input.overloadReceipts.length!==2)throw new Error('overload_count');const overloadActors:InfrastructureActorV33_53[]=[],overloadPids=new Set<number>();for(const r of input.overloadReceipts){verifyEnvelope(r,input.trust.overloadRegistry,input.trust.trustedOverloadSignerIds,at,'overload_signature');assertDigest(r.payload as unknown as Record<string,unknown>,'receiptDigest','overload_digest');if(r.issuerKeyId!==r.payload.worker.keyId||r.payload.policyDigest!==input.policy.payload.policyDigest||r.payload.acceptedOperations+r.payload.rejectedOperations!==r.payload.attemptedOperations||r.payload.rejectedOperations<input.policy.payload.requiredRejectedOperations||r.payload.highWatermark!==input.policy.payload.overloadHighWatermark||r.payload.lowWatermark!==input.policy.payload.overloadLowWatermark||r.payload.drainedBacklogCount>input.policy.payload.overloadLowWatermark||!r.payload.pressureActivated||!r.payload.hysteresisHeld||!r.payload.pressureCleared)throw new Error('overload_receipt_contract');overloadActors.push(r.payload.worker);overloadPids.add(r.payload.processId);}distinctActors(overloadActors,'overload_worker_separation');if(overloadPids.size!==2)throw new Error('overload_process_collision');
  verifyEnvelope(input.recovery,input.trust.recoveryRegistry,input.trust.trustedRecoverySignerIds,at,'recovery_signature');assertDigest(input.recovery.payload as unknown as Record<string,unknown>,'recoveryDigest','recovery_digest');const rr=input.recovery.payload;const postMap=new Map(input.postFailoverStoreReceipts.map(r=>[r.payload.receiptDigest,r]));if(rr.sourceStoreReceiptDigests.length!==2||rr.sourceStoreReceiptDigests.some(d=>!postMap.has(d))||rr.restoredJournalHeadDigest!==post.journalHeadDigest||rr.restoredBytesDigest!==post.exactBytesDigest||rr.readBackDigest!==rr.restoredBytesDigest||rr.restoredByteLength!==post.exactByteLength||rr.restoredEntryCount!==input.baseAuditVerdict.payload.journalEntryCount||rr.auditReplayDigest!==input.baseAuditVerdict.payload.verdictDigest||!rr.noGap||!rr.noFork||rr.recoveryActor.siteId===rr.lostSiteId)throw new Error('recovery_contract');
  const allAtt=[...input.storeAttestations,...input.workerAttestations];const allExternal=allAtt.every(a=>a.payload.topology==='INDEPENDENT_EXTERNAL_ATTESTED'&&a.payload.externalEvidenceDigest!==null&&input.trust.trustedExternalEvidenceDigests.includes(a.payload.externalEvidenceDigest)&&isPublicEndpoint(a.payload.endpoint))&&input.clockAttestations.every(c=>c.payload.topology==='INDEPENDENT_EXTERNAL_ATTESTED'&&c.payload.externalEvidenceDigest!==null&&input.trust.trustedExternalEvidenceDigests.includes(c.payload.externalEvidenceDigest));
  const extCount=allAtt.filter(a=>a.payload.externalEvidenceDigest!==null&&input.trust.trustedExternalEvidenceDigests.includes(a.payload.externalEvidenceDigest)).length+input.clockAttestations.filter(c=>c.payload.externalEvidenceDigest!==null&&input.trust.trustedExternalEvidenceDigests.includes(c.payload.externalEvidenceDigest)).length;
  const m={version:'33.53' as const,status:(allExternal?'EXTERNAL_PERSISTENCE_INFRASTRUCTURE_QUALIFIED':'LOCAL_PERSISTENCE_INFRASTRUCTURE_QUALIFICATION_REHEARSAL_ONLY') as PersistenceInfrastructureQualificationVerdictPayloadV33_53['status'],qualificationId:input.policy.payload.qualificationId,policyDigest:input.policy.payload.policyDigest,baseAuditVerdictDigest:input.baseAuditVerdict.payload.verdictDigest,storeAttestationDigests:input.storeAttestations.map(x=>x.payload.attestationDigest).sort(),workerAttestationDigests:input.workerAttestations.map(x=>x.payload.attestationDigest).sort(),clockDigests:input.clockAttestations.map(x=>x.payload.clockDigest).sort(),initialStoreReceiptDigests:input.initialStoreReceipts.map(x=>x.payload.receiptDigest).sort(),failoverDigest:f.failoverDigest,postFailoverStoreReceiptDigests:input.postFailoverStoreReceipts.map(x=>x.payload.receiptDigest).sort(),overloadReceiptDigests:input.overloadReceipts.map(x=>x.payload.receiptDigest).sort(),recoveryDigest:rr.recoveryDigest,distinctStoreProcesses:3 as const,distinctWorkerProcesses:2 as const,independentClockQuorumVerified:true as const,partitionFailoverVerified:true as const,overloadBackpressureVerified:true as const,siteLossAuditReplayVerified:true as const,exactByteReplicationVerified:true as const,externalTopologyObserved:allExternal,externalInfrastructureAttestations:extCount,externalHumanParticipants:0 as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const,verifiedAt:at.toISOString()};
  return signEnvelope({...m,verdictDigest:sha256(m)},input.signer);
}
export function verifyPersistenceInfrastructureQualificationVerdictV33_53(input:{verdict:SignedEnvelope<PersistenceInfrastructureQualificationVerdictPayloadV33_53>;recomputed:SignedEnvelope<PersistenceInfrastructureQualificationVerdictPayloadV33_53>;trust:PersistenceInfrastructureQualificationTrustV33_53;verifiedAt:Date}){
  verifyEnvelope(input.verdict,input.trust.verdictRegistry,input.trust.trustedVerdictSignerIds,input.verifiedAt,'verdict_signature');assertDigest(input.verdict.payload as unknown as Record<string,unknown>,'verdictDigest','verdict_digest');
  if(input.verdict.payload.verdictDigest!==input.recomputed.payload.verdictDigest||sha256(input.verdict.payload)!==sha256(input.recomputed.payload))throw new Error('verdict_recompute');
  if(input.verdict.payload.productionAuthority!=='NONE'||input.verdict.payload.externalEffectsExecuted!==0||input.verdict.payload.externalHumanParticipants!==0)throw new Error('verdict_truth_boundary');
  return input.verdict.payload;
}
