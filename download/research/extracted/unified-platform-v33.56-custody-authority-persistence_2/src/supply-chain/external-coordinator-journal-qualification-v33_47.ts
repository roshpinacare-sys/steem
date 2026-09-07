import { KeyRegistry, sha256, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { DurableCoordinatorVerdictV33_46 } from './durable-transaction-coordinator-v33_46.js';

export type CoordinatorQualificationTopologyV33_47 = 'LOCAL_MULTI_HOST_REHEARSAL' | 'INDEPENDENT_EXTERNAL_ATTESTED';
export interface CoordinatorHostV33_47 { readonly keyId:string; readonly organization:string; readonly host:string; readonly administrator:string; }
export interface HostQualificationAttestationPayloadV33_47 {
  readonly version:'33.47'; readonly subject:CoordinatorHostV33_47; readonly topology:CoordinatorQualificationTopologyV33_47;
  readonly providerEvidenceDigest:string|null; readonly observedAt:string; readonly productionAuthority:'NONE'; readonly externalEffectsExecuted:0;
  readonly attestationDigest:string;
}
export interface ClockAttestationPayloadV33_47 {
  readonly version:'33.47'; readonly sourceId:string; readonly sourceOrganization:string; readonly sourceHost:string; readonly sourceAdministrator:string;
  readonly unixTimeMs:number; readonly maximumErrorMs:number; readonly observedAt:string; readonly topology:CoordinatorQualificationTopologyV33_47;
  readonly externalEvidenceDigest:string|null; readonly productionAuthority:'NONE'; readonly externalEffectsExecuted:0; readonly clockDigest:string;
}
export interface ReplicatedJournalReceiptPayloadV33_47 {
  readonly version:'33.47'; readonly baseCoordinatorVerdictDigest:string; readonly journalHeadDigest:string; readonly journalBytesDigest:string;
  readonly journalEntryCount:number; readonly replicationEpoch:number; readonly coordinatorTerm:number; readonly coordinatorKeyId:string;
  readonly replica:CoordinatorHostV33_47; readonly processId:number; readonly byteLength:number; readonly clockDigests:readonly string[];
  readonly fileFsync:true; readonly directoryFsync:true; readonly rereadVerified:true; readonly topology:CoordinatorQualificationTopologyV33_47;
  readonly storedAt:string; readonly productionAuthority:'NONE'; readonly externalEffectsExecuted:0; readonly receiptDigest:string;
}
export interface PartitionObservationPayloadV33_47 {
  readonly version:'33.47'; readonly partitionId:string; readonly predecessorCoordinator:CoordinatorHostV33_47;
  readonly observer:CoordinatorHostV33_47; readonly journalHeadDigest:string; readonly partitionStartedAt:string; readonly observedAt:string;
  readonly minimumPartitionMs:number; readonly decision:'PREDECESSOR_UNREACHABLE'; readonly productionAuthority:'NONE'; readonly externalEffectsExecuted:0;
  readonly observationDigest:string;
}
export interface ExternalFailoverCertificatePayloadV33_47 {
  readonly version:'33.47'; readonly baseCoordinatorVerdictDigest:string; readonly predecessorCoordinator:CoordinatorHostV33_47;
  readonly successorCoordinator:CoordinatorHostV33_47; readonly predecessorTerm:number; readonly successorTerm:number; readonly fenceSequence:number;
  readonly predecessorJournalHeadDigest:string; readonly partitionObservationDigests:readonly string[]; readonly clockDigests:readonly string[];
  readonly effectiveAt:string; readonly productionAuthority:'NONE'; readonly externalEffectsExecuted:0; readonly failoverDigest:string;
}
export interface ReplicationCheckpointPayloadV33_47 {
  readonly version:'33.47'; readonly failoverDigest:string; readonly replicationEpoch:number; readonly coordinatorTerm:number;
  readonly coordinatorKeyId:string; readonly journalHeadDigest:string; readonly journalBytesDigest:string; readonly replicaReceiptDigests:readonly string[];
  readonly quorum:3; readonly issuedAt:string; readonly productionAuthority:'NONE'; readonly externalEffectsExecuted:0; readonly checkpointDigest:string;
}
export interface SiteLossRecoveryReceiptPayloadV33_47 {
  readonly version:'33.47'; readonly checkpointDigest:string; readonly lostSite:CoordinatorHostV33_47; readonly recoverySite:CoordinatorHostV33_47;
  readonly sourceReplicaReceiptDigests:readonly string[]; readonly restoredJournalHeadDigest:string; readonly restoredJournalBytesDigest:string;
  readonly restoredEntryCount:number; readonly restoredByteLength:number; readonly nextSequence:number; readonly processId:number;
  readonly fileFsync:true; readonly directoryFsync:true; readonly rereadVerified:true; readonly noGap:true; readonly noFork:true;
  readonly recoveredAt:string; readonly productionAuthority:'NONE'; readonly externalEffectsExecuted:0; readonly recoveryDigest:string;
}
export interface ExternalCoordinatorJournalQualificationTrustV33_47 {
  readonly topologyAuditorRegistry:KeyRegistry; readonly trustedTopologyAuditorIds:readonly string[];
  readonly timeRegistry:KeyRegistry; readonly trustedTimeSourceIds:readonly string[];
  readonly replicaRegistry:KeyRegistry; readonly trustedReplicaIds:readonly string[];
  readonly partitionRegistry:KeyRegistry; readonly trustedPartitionObserverIds:readonly string[];
  readonly failoverRegistry:KeyRegistry; readonly trustedFailoverAuthorityIds:readonly string[];
  readonly checkpointRegistry:KeyRegistry; readonly trustedCheckpointAuthorityIds:readonly string[];
  readonly recoveryRegistry:KeyRegistry; readonly trustedRecoveryAuthorityIds:readonly string[];
  readonly trustedExternalEvidenceDigests:readonly string[]; readonly maximumClockSkewMs:number; readonly minimumPartitionMs:number;
}
export interface ExternalCoordinatorJournalQualificationVerdictV33_47 {
  readonly version:'33.47'; readonly status:'LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY'|'EXTERNAL_COORDINATOR_JOURNAL_QUALIFIED';
  readonly baseCoordinatorVerdictDigest:string; readonly hostAttestationDigests:readonly string[]; readonly clockDigests:readonly string[];
  readonly initialReplicaReceiptDigests:readonly string[]; readonly failoverDigest:string; readonly postFailoverReplicaReceiptDigests:readonly string[];
  readonly checkpointDigest:string; readonly recoveryDigest:string; readonly journalHeadDigest:string; readonly journalBytesDigest:string;
  readonly initialReplicaCount:3; readonly postFailoverReplicaCount:3; readonly distinctReplicaProcessesObserved:true;
  readonly independentClockQuorumVerified:true; readonly partitionFailoverVerified:true; readonly irreversibleFencingVerified:true;
  readonly appendOnlyReplicationVerified:true; readonly siteLossRecoveryVerified:true; readonly externalTopologyObserved:boolean;
  readonly externalHumanParticipants:0; readonly productionAuthority:'NONE'; readonly externalEffectsExecuted:0;
  readonly verifiedAt:string; readonly verdictDigest:string;
}

const digestWithout=<T extends Record<string,unknown>>(payload:T,key:keyof T)=>{const m={...payload};delete m[key];return sha256(m);};
const assertDigest=(payload:Record<string,unknown>,key:string,code:string)=>{const value=payload[key];if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value)||digestWithout(payload,key)!==value)throw new Error(code);};
const verifyEnvelope=<T>(env:SignedEnvelope<T>,registry:KeyRegistry,ids:readonly string[],at:Date,code:string)=>{if(!ids.includes(env.issuerKeyId)||!registry.verifyAt(env,at))throw new Error(code);};
const time=(value:string,code:string)=>{const n=Date.parse(value);if(!Number.isFinite(n))throw new Error(code);return n;};
const actorKey=(actor:CoordinatorHostV33_47)=>`${actor.keyId}|${actor.organization}|${actor.host}|${actor.administrator}`;
const requireDistinctActors=(actors:readonly CoordinatorHostV33_47[],code:string)=>{
  for(const field of ['keyId','organization','host','administrator'] as const){if(new Set(actors.map(a=>a[field])).size!==actors.length)throw new Error(code);}
};
const requireDigest=(value:string,code:string)=>{if(!/^[0-9a-f]{64}$/.test(value))throw new Error(code);};

export function createSignedHostQualificationAttestationV33_47(i:{signer:SigningIdentity;subject:CoordinatorHostV33_47;topology:CoordinatorQualificationTopologyV33_47;providerEvidenceDigest:string|null;observedAt:Date}){
  if(i.subject.keyId.trim()===''||i.subject.organization.trim()===''||i.subject.host.trim()===''||i.subject.administrator.trim()==='')throw new Error('host_attestation_subject_invalid');
  if(i.topology==='INDEPENDENT_EXTERNAL_ATTESTED'&&i.providerEvidenceDigest===null)throw new Error('host_attestation_external_evidence_required');
  if(i.providerEvidenceDigest!==null)requireDigest(i.providerEvidenceDigest,'host_attestation_evidence_digest_invalid');
  const m={version:'33.47' as const,subject:i.subject,topology:i.topology,providerEvidenceDigest:i.providerEvidenceDigest,observedAt:i.observedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,attestationDigest:sha256(m)},i.signer);
}
export function createSignedClockAttestationV33_47(i:{signer:SigningIdentity;sourceId:string;sourceOrganization:string;sourceHost:string;sourceAdministrator:string;unixTimeMs:number;maximumErrorMs:number;observedAt:Date;topology:CoordinatorQualificationTopologyV33_47;externalEvidenceDigest:string|null}){
  if(i.sourceId.trim()===''||i.sourceOrganization.trim()===''||i.sourceHost.trim()===''||i.sourceAdministrator.trim()===''||!Number.isInteger(i.unixTimeMs)||i.maximumErrorMs<0)throw new Error('clock_attestation_invalid');
  if(i.topology==='INDEPENDENT_EXTERNAL_ATTESTED'&&i.externalEvidenceDigest===null)throw new Error('clock_external_evidence_required');
  if(i.externalEvidenceDigest!==null)requireDigest(i.externalEvidenceDigest,'clock_external_evidence_digest_invalid');
  const m={version:'33.47' as const,sourceId:i.sourceId,sourceOrganization:i.sourceOrganization,sourceHost:i.sourceHost,sourceAdministrator:i.sourceAdministrator,unixTimeMs:i.unixTimeMs,maximumErrorMs:i.maximumErrorMs,observedAt:i.observedAt.toISOString(),topology:i.topology,externalEvidenceDigest:i.externalEvidenceDigest,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,clockDigest:sha256(m)},i.signer);
}
export function createSignedReplicatedJournalReceiptV33_47(i:{signer:SigningIdentity;baseCoordinatorVerdictDigest:string;journalHeadDigest:string;journalBytesDigest:string;journalEntryCount:number;replicationEpoch:number;coordinatorTerm:number;coordinatorKeyId:string;replica:CoordinatorHostV33_47;processId:number;byteLength:number;clockDigests:readonly string[];topology:CoordinatorQualificationTopologyV33_47;storedAt:Date}){
  for(const [v,c] of [[i.baseCoordinatorVerdictDigest,'replica_base_digest_invalid'],[i.journalHeadDigest,'replica_head_digest_invalid'],[i.journalBytesDigest,'replica_bytes_digest_invalid']] as const)requireDigest(v,c);
  if(i.journalEntryCount<1||i.replicationEpoch<1||i.coordinatorTerm<1||i.processId<1||i.byteLength<1||i.clockDigests.length<2)throw new Error('replica_receipt_contract_invalid');
  const m={version:'33.47' as const,baseCoordinatorVerdictDigest:i.baseCoordinatorVerdictDigest,journalHeadDigest:i.journalHeadDigest,journalBytesDigest:i.journalBytesDigest,journalEntryCount:i.journalEntryCount,replicationEpoch:i.replicationEpoch,coordinatorTerm:i.coordinatorTerm,coordinatorKeyId:i.coordinatorKeyId,replica:i.replica,processId:i.processId,byteLength:i.byteLength,clockDigests:[...i.clockDigests].sort(),fileFsync:true as const,directoryFsync:true as const,rereadVerified:true as const,topology:i.topology,storedAt:i.storedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,receiptDigest:sha256(m)},i.signer);
}
export function createSignedPartitionObservationV33_47(i:{signer:SigningIdentity;partitionId:string;predecessorCoordinator:CoordinatorHostV33_47;observer:CoordinatorHostV33_47;journalHeadDigest:string;partitionStartedAt:Date;observedAt:Date;minimumPartitionMs:number}){
  if(i.partitionId.trim()===''||i.minimumPartitionMs<1||i.observedAt.getTime()-i.partitionStartedAt.getTime()<i.minimumPartitionMs)throw new Error('partition_observation_too_early');
  const m={version:'33.47' as const,partitionId:i.partitionId,predecessorCoordinator:i.predecessorCoordinator,observer:i.observer,journalHeadDigest:i.journalHeadDigest,partitionStartedAt:i.partitionStartedAt.toISOString(),observedAt:i.observedAt.toISOString(),minimumPartitionMs:i.minimumPartitionMs,decision:'PREDECESSOR_UNREACHABLE' as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,observationDigest:sha256(m)},i.signer);
}
export function createSignedExternalFailoverCertificateV33_47(i:{signer:SigningIdentity;baseCoordinatorVerdictDigest:string;predecessorCoordinator:CoordinatorHostV33_47;successorCoordinator:CoordinatorHostV33_47;predecessorTerm:number;successorTerm:number;fenceSequence:number;predecessorJournalHeadDigest:string;partitionObservationDigests:readonly string[];clockDigests:readonly string[];effectiveAt:Date}){
  if(i.successorTerm!==i.predecessorTerm+1||i.fenceSequence<1||i.partitionObservationDigests.length!==2||i.clockDigests.length<2||actorKey(i.predecessorCoordinator)===actorKey(i.successorCoordinator))throw new Error('external_failover_contract_invalid');
  const m={version:'33.47' as const,baseCoordinatorVerdictDigest:i.baseCoordinatorVerdictDigest,predecessorCoordinator:i.predecessorCoordinator,successorCoordinator:i.successorCoordinator,predecessorTerm:i.predecessorTerm,successorTerm:i.successorTerm,fenceSequence:i.fenceSequence,predecessorJournalHeadDigest:i.predecessorJournalHeadDigest,partitionObservationDigests:[...i.partitionObservationDigests].sort(),clockDigests:[...i.clockDigests].sort(),effectiveAt:i.effectiveAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,failoverDigest:sha256(m)},i.signer);
}
export function createSignedReplicationCheckpointV33_47(i:{signer:SigningIdentity;failoverDigest:string;replicationEpoch:number;coordinatorTerm:number;coordinatorKeyId:string;journalHeadDigest:string;journalBytesDigest:string;replicaReceiptDigests:readonly string[];issuedAt:Date}){
  if(i.replicaReceiptDigests.length!==3||new Set(i.replicaReceiptDigests).size!==3)throw new Error('checkpoint_replica_quorum_invalid');
  const m={version:'33.47' as const,failoverDigest:i.failoverDigest,replicationEpoch:i.replicationEpoch,coordinatorTerm:i.coordinatorTerm,coordinatorKeyId:i.coordinatorKeyId,journalHeadDigest:i.journalHeadDigest,journalBytesDigest:i.journalBytesDigest,replicaReceiptDigests:[...i.replicaReceiptDigests].sort(),quorum:3 as const,issuedAt:i.issuedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,checkpointDigest:sha256(m)},i.signer);
}
export function createSignedSiteLossRecoveryReceiptV33_47(i:{signer:SigningIdentity;checkpointDigest:string;lostSite:CoordinatorHostV33_47;recoverySite:CoordinatorHostV33_47;sourceReplicaReceiptDigests:readonly string[];restoredJournalHeadDigest:string;restoredJournalBytesDigest:string;restoredEntryCount:number;restoredByteLength:number;nextSequence:number;processId:number;recoveredAt:Date}){
  if(i.sourceReplicaReceiptDigests.length!==2||new Set(i.sourceReplicaReceiptDigests).size!==2||actorKey(i.lostSite)===actorKey(i.recoverySite)||i.restoredEntryCount<1||i.restoredByteLength<1||i.nextSequence!==i.restoredEntryCount+1||i.processId<1)throw new Error('site_recovery_contract_invalid');
  const m={version:'33.47' as const,checkpointDigest:i.checkpointDigest,lostSite:i.lostSite,recoverySite:i.recoverySite,sourceReplicaReceiptDigests:[...i.sourceReplicaReceiptDigests].sort(),restoredJournalHeadDigest:i.restoredJournalHeadDigest,restoredJournalBytesDigest:i.restoredJournalBytesDigest,restoredEntryCount:i.restoredEntryCount,restoredByteLength:i.restoredByteLength,nextSequence:i.nextSequence,processId:i.processId,fileFsync:true as const,directoryFsync:true as const,rereadVerified:true as const,noGap:true as const,noFork:true as const,recoveredAt:i.recoveredAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,recoveryDigest:sha256(m)},i.signer);
}

export function verifyExternalCoordinatorJournalQualificationV33_47(i:{
  baseVerdict:DurableCoordinatorVerdictV33_46; hostAttestations:readonly SignedEnvelope<HostQualificationAttestationPayloadV33_47>[];
  clockAttestations:readonly SignedEnvelope<ClockAttestationPayloadV33_47>[]; initialReplicaReceipts:readonly SignedEnvelope<ReplicatedJournalReceiptPayloadV33_47>[];
  partitionObservations:readonly SignedEnvelope<PartitionObservationPayloadV33_47>[]; failoverCertificate:SignedEnvelope<ExternalFailoverCertificatePayloadV33_47>;
  postFailoverReplicaReceipts:readonly SignedEnvelope<ReplicatedJournalReceiptPayloadV33_47>[]; checkpoint:SignedEnvelope<ReplicationCheckpointPayloadV33_47>;
  recoveryReceipt:SignedEnvelope<SiteLossRecoveryReceiptPayloadV33_47>; trust:ExternalCoordinatorJournalQualificationTrustV33_47; verifiedAt:Date;
}):ExternalCoordinatorJournalQualificationVerdictV33_47{
  const at=i.verifiedAt;if(i.baseVerdict.status!=='LOCAL_DURABLE_TRANSACTION_COORDINATOR_FAILOVER_PROVEN'||i.baseVerdict.productionAuthority!=='NONE'||i.baseVerdict.externalEffectsExecuted!==0)throw new Error('external_qualification_base_invalid');
  if(i.hostAttestations.length!==4)throw new Error('host_attestation_inventory_invalid');
  const hostMap=new Map<string,SignedEnvelope<HostQualificationAttestationPayloadV33_47>>();const auditorIds=new Set<string>();
  for(const a of i.hostAttestations){verifyEnvelope(a,i.trust.topologyAuditorRegistry,i.trust.trustedTopologyAuditorIds,at,'host_attestation_signature_invalid');assertDigest(a.payload as unknown as Record<string,unknown>,'attestationDigest','host_attestation_digest_invalid');if(a.payload.productionAuthority!=='NONE'||a.payload.externalEffectsExecuted!==0)throw new Error('host_attestation_truth_boundary_invalid');const k=actorKey(a.payload.subject);if(hostMap.has(k))throw new Error('host_attestation_duplicate_subject');hostMap.set(k,a);auditorIds.add(a.issuerKeyId);}
  if(auditorIds.size<2)throw new Error('host_attestation_auditor_independence_invalid');requireDistinctActors([...hostMap.values()].map(x=>x.payload.subject),'qualified_hosts_not_independent');
  if(i.clockAttestations.length<2)throw new Error('clock_quorum_invalid');const clockIds=new Set<string>(),clockOrgs=new Set<string>(),clockHosts=new Set<string>(),clockAdmins=new Set<string>(),clockDigests=new Set<string>();const clockTimes:number[]=[];
  for(const c of i.clockAttestations){verifyEnvelope(c,i.trust.timeRegistry,i.trust.trustedTimeSourceIds,at,'clock_signature_invalid');assertDigest(c.payload as unknown as Record<string,unknown>,'clockDigest','clock_digest_invalid');if(c.payload.maximumErrorMs>i.trust.maximumClockSkewMs||c.payload.productionAuthority!=='NONE'||c.payload.externalEffectsExecuted!==0)throw new Error('clock_contract_invalid');clockIds.add(c.issuerKeyId);clockOrgs.add(c.payload.sourceOrganization);clockHosts.add(c.payload.sourceHost);clockAdmins.add(c.payload.sourceAdministrator);clockDigests.add(c.payload.clockDigest);clockTimes.push(c.payload.unixTimeMs);}
  if(clockIds.size<2||clockOrgs.size<2||clockHosts.size<2||clockAdmins.size<2||Math.max(...clockTimes)-Math.min(...clockTimes)>i.trust.maximumClockSkewMs)throw new Error('clock_independence_or_skew_invalid');
  const verifyReceipts=(receipts:readonly SignedEnvelope<ReplicatedJournalReceiptPayloadV33_47>[],epoch:number,term:number,coordinatorKeyId:string,code:string)=>{
    if(receipts.length!==3)throw new Error(`${code}_count_invalid`);const actors:CoordinatorHostV33_47[]=[];const pids=new Set<number>();const digests=new Set<string>();
    for(const r of receipts){verifyEnvelope(r,i.trust.replicaRegistry,i.trust.trustedReplicaIds,at,`${code}_signature_invalid`);assertDigest(r.payload as unknown as Record<string,unknown>,'receiptDigest',`${code}_digest_invalid`);if(r.issuerKeyId!==r.payload.replica.keyId||!hostMap.has(actorKey(r.payload.replica))||r.payload.baseCoordinatorVerdictDigest!==i.baseVerdict.verdictDigest||r.payload.journalHeadDigest!==i.baseVerdict.journalHeadDigest||r.payload.journalEntryCount!==i.baseVerdict.journalEntryCount||r.payload.replicationEpoch!==epoch||r.payload.coordinatorTerm!==term||r.payload.coordinatorKeyId!==coordinatorKeyId||r.payload.clockDigests.length<2||r.payload.clockDigests.some(d=>!clockDigests.has(d))||!r.payload.fileFsync||!r.payload.directoryFsync||!r.payload.rereadVerified||r.payload.productionAuthority!=='NONE'||r.payload.externalEffectsExecuted!==0)throw new Error(`${code}_contract_invalid`);actors.push(r.payload.replica);pids.add(r.payload.processId);digests.add(r.payload.receiptDigest);}
    requireDistinctActors(actors,`${code}_actors_not_independent`);if(pids.size!==3||digests.size!==3)throw new Error(`${code}_process_or_digest_duplicate`);const first=receipts[0]!.payload;if(receipts.some(r=>r.payload.journalBytesDigest!==first.journalBytesDigest||r.payload.byteLength!==first.byteLength||r.payload.topology!==first.topology))throw new Error(`${code}_replica_view_mismatch`);return {actors,pids,journalBytesDigest:first.journalBytesDigest,byteLength:first.byteLength,topology:first.topology};
  };
  const initialCoordinator=i.hostAttestations[0]!.payload.subject;const initial=verifyReceipts(i.initialReplicaReceipts,1,3,initialCoordinator.keyId,'initial_replica');
  if(i.partitionObservations.length!==2)throw new Error('partition_observation_quorum_invalid');const obsActors:CoordinatorHostV33_47[]=[];const obsDigests=new Set<string>();let partitionId:string|undefined;let partitionStart=0;let latestObserved=0;
  for(const o of i.partitionObservations){verifyEnvelope(o,i.trust.partitionRegistry,i.trust.trustedPartitionObserverIds,at,'partition_observation_signature_invalid');assertDigest(o.payload as unknown as Record<string,unknown>,'observationDigest','partition_observation_digest_invalid');if(o.issuerKeyId!==o.payload.observer.keyId||actorKey(o.payload.predecessorCoordinator)!==actorKey(initialCoordinator)||o.payload.journalHeadDigest!==i.baseVerdict.journalHeadDigest||o.payload.minimumPartitionMs<i.trust.minimumPartitionMs||time(o.payload.observedAt,'partition_observed_at_invalid')-time(o.payload.partitionStartedAt,'partition_started_at_invalid')<i.trust.minimumPartitionMs||actorKey(o.payload.observer)===actorKey(initialCoordinator))throw new Error('partition_observation_contract_invalid');if(partitionId!==undefined&&partitionId!==o.payload.partitionId)throw new Error('partition_id_mismatch');partitionId=o.payload.partitionId;partitionStart=time(o.payload.partitionStartedAt,'partition_started_at_invalid');latestObserved=Math.max(latestObserved,time(o.payload.observedAt,'partition_observed_at_invalid'));obsActors.push(o.payload.observer);obsDigests.add(o.payload.observationDigest);}
  requireDistinctActors(obsActors,'partition_observers_not_independent');if(obsDigests.size!==2)throw new Error('partition_observation_duplicate');
  verifyEnvelope(i.failoverCertificate,i.trust.failoverRegistry,i.trust.trustedFailoverAuthorityIds,at,'failover_signature_invalid');assertDigest(i.failoverCertificate.payload as unknown as Record<string,unknown>,'failoverDigest','failover_digest_invalid');const f=i.failoverCertificate.payload;
  if(f.baseCoordinatorVerdictDigest!==i.baseVerdict.verdictDigest||actorKey(f.predecessorCoordinator)!==actorKey(initialCoordinator)||f.predecessorTerm!==3||f.successorTerm!==4||f.fenceSequence!==i.baseVerdict.journalEntryCount+1||f.predecessorJournalHeadDigest!==i.baseVerdict.journalHeadDigest||JSON.stringify(f.partitionObservationDigests)!==JSON.stringify([...obsDigests].sort())||f.clockDigests.length<2||f.clockDigests.some(d=>!clockDigests.has(d))||time(f.effectiveAt,'failover_effective_at_invalid')<Math.max(latestObserved,partitionStart+i.trust.minimumPartitionMs)||actorKey(f.successorCoordinator)===actorKey(f.predecessorCoordinator)||!hostMap.has(actorKey(f.successorCoordinator))||f.productionAuthority!=='NONE'||f.externalEffectsExecuted!==0)throw new Error('failover_contract_invalid');
  const post=verifyReceipts(i.postFailoverReplicaReceipts,2,4,f.successorCoordinator.keyId,'post_failover_replica');if(post.journalBytesDigest!==initial.journalBytesDigest||post.byteLength!==initial.byteLength)throw new Error('append_only_replication_bytes_changed');
  verifyEnvelope(i.checkpoint,i.trust.checkpointRegistry,i.trust.trustedCheckpointAuthorityIds,at,'checkpoint_signature_invalid');assertDigest(i.checkpoint.payload as unknown as Record<string,unknown>,'checkpointDigest','checkpoint_digest_invalid');const cp=i.checkpoint.payload;const postDigests=i.postFailoverReplicaReceipts.map(r=>r.payload.receiptDigest).sort();if(cp.failoverDigest!==f.failoverDigest||cp.replicationEpoch!==2||cp.coordinatorTerm!==4||cp.coordinatorKeyId!==f.successorCoordinator.keyId||cp.journalHeadDigest!==i.baseVerdict.journalHeadDigest||cp.journalBytesDigest!==post.journalBytesDigest||JSON.stringify(cp.replicaReceiptDigests)!==JSON.stringify(postDigests)||cp.quorum!==3||cp.productionAuthority!=='NONE'||cp.externalEffectsExecuted!==0)throw new Error('checkpoint_contract_invalid');
  verifyEnvelope(i.recoveryReceipt,i.trust.recoveryRegistry,i.trust.trustedRecoveryAuthorityIds,at,'site_recovery_signature_invalid');assertDigest(i.recoveryReceipt.payload as unknown as Record<string,unknown>,'recoveryDigest','site_recovery_digest_invalid');const rr=i.recoveryReceipt.payload;const postByDigest=new Map(i.postFailoverReplicaReceipts.map(r=>[r.payload.receiptDigest,r]));if(rr.checkpointDigest!==cp.checkpointDigest||rr.sourceReplicaReceiptDigests.length!==2||rr.sourceReplicaReceiptDigests.some(d=>!postByDigest.has(d))||actorKey(rr.lostSite)===actorKey(rr.recoverySite)||!hostMap.has(actorKey(rr.lostSite))||!hostMap.has(actorKey(rr.recoverySite))||rr.restoredJournalHeadDigest!==cp.journalHeadDigest||rr.restoredJournalBytesDigest!==cp.journalBytesDigest||rr.restoredEntryCount!==i.baseVerdict.journalEntryCount||rr.nextSequence!==f.fenceSequence||rr.restoredByteLength!==post.byteLength||!rr.fileFsync||!rr.directoryFsync||!rr.rereadVerified||!rr.noGap||!rr.noFork||rr.productionAuthority!=='NONE'||rr.externalEffectsExecuted!==0)throw new Error('site_recovery_contract_invalid');
  const external=[...i.hostAttestations].every(a=>a.payload.topology==='INDEPENDENT_EXTERNAL_ATTESTED'&&a.payload.providerEvidenceDigest!==null&&i.trust.trustedExternalEvidenceDigests.includes(a.payload.providerEvidenceDigest))&&i.clockAttestations.every(c=>c.payload.topology==='INDEPENDENT_EXTERNAL_ATTESTED'&&c.payload.externalEvidenceDigest!==null&&i.trust.trustedExternalEvidenceDigests.includes(c.payload.externalEvidenceDigest));
  const m={version:'33.47' as const,status:(external?'EXTERNAL_COORDINATOR_JOURNAL_QUALIFIED':'LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY') as ExternalCoordinatorJournalQualificationVerdictV33_47['status'],baseCoordinatorVerdictDigest:i.baseVerdict.verdictDigest,hostAttestationDigests:i.hostAttestations.map(a=>a.payload.attestationDigest).sort(),clockDigests:[...clockDigests].sort(),initialReplicaReceiptDigests:i.initialReplicaReceipts.map(r=>r.payload.receiptDigest).sort(),failoverDigest:f.failoverDigest,postFailoverReplicaReceiptDigests:postDigests,checkpointDigest:cp.checkpointDigest,recoveryDigest:rr.recoveryDigest,journalHeadDigest:i.baseVerdict.journalHeadDigest,journalBytesDigest:post.journalBytesDigest,initialReplicaCount:3 as const,postFailoverReplicaCount:3 as const,distinctReplicaProcessesObserved:true as const,independentClockQuorumVerified:true as const,partitionFailoverVerified:true as const,irreversibleFencingVerified:true as const,appendOnlyReplicationVerified:true as const,siteLossRecoveryVerified:true as const,externalTopologyObserved:external,externalHumanParticipants:0 as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const,verifiedAt:at.toISOString()};return {...m,verdictDigest:sha256(m)};
}
