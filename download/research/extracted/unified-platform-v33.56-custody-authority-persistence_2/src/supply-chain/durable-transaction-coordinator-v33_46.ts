import { KeyRegistry, sha256, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { MultiPackageUpdateTransactionVerdictV33_45 } from './multi-package-update-transaction-v33_45.js';

export type CoordinatorStageV33_46 =
  | 'PREPARED' | 'CANARY_STAGE_1_COMPLETED' | 'CANARY_STAGE_2_STARTED' | 'CANARY_STAGE_2_RESUMED'
  | 'CANARY_STAGE_2_COMPLETED' | 'CANARY_STAGE_3_COMPLETED' | 'PROMOTION_PREPARED' | 'PROMOTION_RESUMED'
  | 'PROMOTION_COMMITTED';

export interface CoordinatorPolicyPayloadV33_46 {
  readonly version:'33.46'; readonly transactionPlanDigest:string; readonly takeoverWitnessQuorum:3;
  readonly expirySafetyDelayMs:number; readonly commandTimeoutMs:number; readonly minimumDurableReplicas:1;
  readonly requireFileFsync:true; readonly requireDirectoryFsync:true; readonly generatedAt:string; readonly policyDigest:string;
}
export interface CoordinatorIdentityV33_46 { readonly keyId:string; readonly organization:string; readonly host:string; }
export interface CoordinatorLeasePayloadV33_46 {
  readonly version:'33.46'; readonly transactionPlanDigest:string; readonly coordinator:CoordinatorIdentityV33_46;
  readonly term:number; readonly sequenceStart:number; readonly sequenceEnd:number; readonly issuedAt:string; readonly expiresAt:string;
  readonly leaseDigest:string;
}
export interface JournalEntryPayloadV33_46 {
  readonly version:'33.46'; readonly transactionPlanDigest:string; readonly policyDigest:string; readonly term:number;
  readonly sequence:number; readonly coordinator:CoordinatorIdentityV33_46; readonly authorityDigest:string;
  readonly stage:CoordinatorStageV33_46; readonly commandId:string; readonly idempotencyKey:string;
  readonly predecessorEntryDigest:string|null; readonly eventTime:string; readonly entryDigest:string;
}
export interface TakeoverWitnessVotePayloadV33_46 {
  readonly version:'33.46'; readonly transactionPlanDigest:string; readonly predecessorAuthorityDigest:string;
  readonly predecessorTerm:number; readonly successorTerm:number; readonly successor:CoordinatorIdentityV33_46;
  readonly fenceSequence:number; readonly observedExpiredAt:string; readonly witnessOrganization:string; readonly witnessHost:string;
  readonly voteDigest:string;
}
export interface CoordinatorTakeoverPayloadV33_46 {
  readonly version:'33.46'; readonly transactionPlanDigest:string; readonly predecessorAuthorityDigest:string;
  readonly predecessorTerm:number; readonly successorTerm:number; readonly successor:CoordinatorIdentityV33_46;
  readonly fenceSequence:number; readonly voteDigests:readonly string[]; readonly effectiveAt:string; readonly takeoverDigest:string;
}
export interface DurableJournalReceiptPayloadV33_46 {
  readonly version:'33.46'; readonly transactionPlanDigest:string; readonly entryDigests:readonly string[];
  readonly journalHeadDigest:string; readonly byteLength:number; readonly fileFsync:true; readonly directoryFsync:true;
  readonly replicaCount:number; readonly storedAt:string; readonly receiptDigest:string;
}
export interface IdempotentReplayReceiptPayloadV33_46 {
  readonly version:'33.46'; readonly transactionPlanDigest:string; readonly idempotencyKey:string;
  readonly originalEntryDigest:string; readonly originalSequence:number; readonly duplicateCommandDigest:string;
  readonly noNewJournalEntry:true; readonly observedAt:string; readonly receiptDigest:string;
}
export interface TimeoutCompensationPayloadV33_46 {
  readonly version:'33.46'; readonly transactionPlanDigest:string; readonly timedOutEntryDigest:string;
  readonly timeoutAt:string; readonly decision:'FULL_ROLLBACK_TO_BASE'; readonly targetManifestDigest:string;
  readonly productionEffectsExecuted:0; readonly decidedAt:string; readonly compensationDigest:string;
}
export interface CrashRecoveryReceiptPayloadV33_46 {
  readonly version:'33.46'; readonly transactionPlanDigest:string; readonly takeoverDigest:string;
  readonly predecessorJournalHeadDigest:string; readonly resumedSequence:number; readonly resumedStage:CoordinatorStageV33_46;
  readonly recoveringCoordinator:CoordinatorIdentityV33_46; readonly noGap:true; readonly noFork:true;
  readonly recoveredAt:string; readonly recoveryDigest:string;
}
export interface DurableCoordinatorVerdictV33_46 {
  readonly version:'33.46'; readonly status:'LOCAL_DURABLE_TRANSACTION_COORDINATOR_FAILOVER_PROVEN';
  readonly baseTransactionVerdictDigest:string; readonly policyDigest:string; readonly initialLeaseDigest:string;
  readonly takeoverDigests:readonly string[]; readonly journalHeadDigest:string; readonly durabilityReceiptDigest:string;
  readonly replayReceiptDigests:readonly string[]; readonly timeoutCompensationDigest:string; readonly recoveryDigests:readonly string[];
  readonly journalEntryCount:number; readonly coordinatorTermCount:number; readonly takeoverCount:number;
  readonly replayReceiptCount:number; readonly crashRecoveryCount:number; readonly monotonicJournalProven:true;
  readonly irreversibleFencingProven:true; readonly idempotentReplayProven:true; readonly timeoutCompensationProven:true;
  readonly multiProcessFailoverProven:true; readonly updatePromoted:false; readonly externalCoordinatorHostsObserved:false;
  readonly externalHumanParticipants:0; readonly productionAuthority:'NONE'; readonly externalEffectsExecuted:0;
  readonly verifiedAt:string; readonly verdictDigest:string;
}
export interface DurableCoordinatorTrustV33_46 {
  readonly policyRegistry:KeyRegistry; readonly trustedPolicySignerIds:readonly string[];
  readonly leaseRegistry:KeyRegistry; readonly trustedLeaseSignerIds:readonly string[];
  readonly coordinatorRegistry:KeyRegistry; readonly trustedCoordinatorIds:readonly string[];
  readonly witnessRegistry:KeyRegistry; readonly trustedWitnessIds:readonly string[];
  readonly takeoverRegistry:KeyRegistry; readonly trustedTakeoverSignerIds:readonly string[];
  readonly storageRegistry:KeyRegistry; readonly trustedStorageSignerIds:readonly string[];
  readonly replayRegistry:KeyRegistry; readonly trustedReplaySignerIds:readonly string[];
  readonly compensationRegistry:KeyRegistry; readonly trustedCompensationSignerIds:readonly string[];
  readonly recoveryRegistry:KeyRegistry; readonly trustedRecoverySignerIds:readonly string[];
}

const hex=(v:string,e:string)=>{if(!/^[0-9a-f]{64}$/.test(v))throw new Error(e);};
const nonEmpty=(v:string,e:string)=>{if(v.trim()==='')throw new Error(e);};
const iso=(v:string,e:string)=>{const n=Date.parse(v);if(!Number.isFinite(n))throw new Error(e);return n;};
const digestWithout=<T extends Record<string,unknown>>(p:T,k:keyof T)=>{const m={...p};delete m[k];return sha256(m);};
const assertDigest=(p:Record<string,unknown>,k:string,e:string)=>{const v=p[k];if(typeof v!=='string'||digestWithout(p,k)!==v)throw new Error(e);};
const verifyEnvelope=<T>(e:SignedEnvelope<T>,r:KeyRegistry,ids:readonly string[],at:Date,err:string)=>{if(!ids.includes(e.issuerKeyId)||!r.verifyAt(e,at))throw new Error(err);};
const identityKey=(i:CoordinatorIdentityV33_46)=>`${i.keyId}|${i.organization}|${i.host}`;

export function createSignedCoordinatorPolicyV33_46(i:{signer:SigningIdentity;transactionPlanDigest:string;expirySafetyDelayMs:number;commandTimeoutMs:number;generatedAt:Date}){
  hex(i.transactionPlanDigest,'coordinator_policy_transaction_digest_invalid'); if(i.expirySafetyDelayMs<0||i.commandTimeoutMs<=0)throw new Error('coordinator_policy_timing_invalid');
  const m={version:'33.46' as const,transactionPlanDigest:i.transactionPlanDigest,takeoverWitnessQuorum:3 as const,expirySafetyDelayMs:i.expirySafetyDelayMs,commandTimeoutMs:i.commandTimeoutMs,minimumDurableReplicas:1 as const,requireFileFsync:true as const,requireDirectoryFsync:true as const,generatedAt:i.generatedAt.toISOString()};
  return signEnvelope({...m,policyDigest:sha256(m)},i.signer);
}
export function createSignedCoordinatorLeaseV33_46(i:{signer:SigningIdentity;transactionPlanDigest:string;coordinator:CoordinatorIdentityV33_46;term:number;sequenceStart:number;sequenceEnd:number;issuedAt:Date;expiresAt:Date}){
  if(i.term<1||i.sequenceStart<1||i.sequenceEnd<i.sequenceStart||i.expiresAt<=i.issuedAt)throw new Error('coordinator_lease_contract_invalid'); nonEmpty(i.coordinator.organization,'coordinator_organization_required'); nonEmpty(i.coordinator.host,'coordinator_host_required');
  const m={version:'33.46' as const,transactionPlanDigest:i.transactionPlanDigest,coordinator:i.coordinator,term:i.term,sequenceStart:i.sequenceStart,sequenceEnd:i.sequenceEnd,issuedAt:i.issuedAt.toISOString(),expiresAt:i.expiresAt.toISOString()};return signEnvelope({...m,leaseDigest:sha256(m)},i.signer);
}
export function createSignedJournalEntryV33_46(i:{signer:SigningIdentity;transactionPlanDigest:string;policyDigest:string;term:number;sequence:number;coordinator:CoordinatorIdentityV33_46;authorityDigest:string;stage:CoordinatorStageV33_46;commandId:string;idempotencyKey:string;predecessorEntryDigest:string|null;eventTime:Date}){
  nonEmpty(i.commandId,'journal_command_required');nonEmpty(i.idempotencyKey,'journal_idempotency_required');if(i.sequence<1||i.term<1)throw new Error('journal_sequence_or_term_invalid');
  const m={version:'33.46' as const,transactionPlanDigest:i.transactionPlanDigest,policyDigest:i.policyDigest,term:i.term,sequence:i.sequence,coordinator:i.coordinator,authorityDigest:i.authorityDigest,stage:i.stage,commandId:i.commandId,idempotencyKey:i.idempotencyKey,predecessorEntryDigest:i.predecessorEntryDigest,eventTime:i.eventTime.toISOString()};return signEnvelope({...m,entryDigest:sha256(m)},i.signer);
}
export function createSignedTakeoverWitnessVoteV33_46(i:{signer:SigningIdentity;transactionPlanDigest:string;predecessorAuthorityDigest:string;predecessorTerm:number;successorTerm:number;successor:CoordinatorIdentityV33_46;fenceSequence:number;observedExpiredAt:Date;witnessOrganization:string;witnessHost:string}){
  if(i.successorTerm!==i.predecessorTerm+1||i.fenceSequence<1)throw new Error('takeover_vote_term_or_fence_invalid');nonEmpty(i.witnessOrganization,'witness_org_required');nonEmpty(i.witnessHost,'witness_host_required');
  const m={version:'33.46' as const,transactionPlanDigest:i.transactionPlanDigest,predecessorAuthorityDigest:i.predecessorAuthorityDigest,predecessorTerm:i.predecessorTerm,successorTerm:i.successorTerm,successor:i.successor,fenceSequence:i.fenceSequence,observedExpiredAt:i.observedExpiredAt.toISOString(),witnessOrganization:i.witnessOrganization,witnessHost:i.witnessHost};return signEnvelope({...m,voteDigest:sha256(m)},i.signer);
}
export function createSignedCoordinatorTakeoverV33_46(i:{signer:SigningIdentity;transactionPlanDigest:string;predecessorAuthorityDigest:string;predecessorTerm:number;successorTerm:number;successor:CoordinatorIdentityV33_46;fenceSequence:number;voteDigests:readonly string[];effectiveAt:Date}){
  if(i.voteDigests.length!==3||new Set(i.voteDigests).size!==3)throw new Error('takeover_vote_digest_quorum_invalid');
  const m={version:'33.46' as const,transactionPlanDigest:i.transactionPlanDigest,predecessorAuthorityDigest:i.predecessorAuthorityDigest,predecessorTerm:i.predecessorTerm,successorTerm:i.successorTerm,successor:i.successor,fenceSequence:i.fenceSequence,voteDigests:[...i.voteDigests].sort(),effectiveAt:i.effectiveAt.toISOString()};return signEnvelope({...m,takeoverDigest:sha256(m)},i.signer);
}
export function createSignedDurableJournalReceiptV33_46(i:{signer:SigningIdentity;transactionPlanDigest:string;entryDigests:readonly string[];journalHeadDigest:string;byteLength:number;replicaCount:number;storedAt:Date}){
  if(i.entryDigests.length<1||i.journalHeadDigest!==i.entryDigests.at(-1)||i.byteLength<=0||i.replicaCount<1)throw new Error('durable_receipt_contract_invalid');
  const m={version:'33.46' as const,transactionPlanDigest:i.transactionPlanDigest,entryDigests:[...i.entryDigests],journalHeadDigest:i.journalHeadDigest,byteLength:i.byteLength,fileFsync:true as const,directoryFsync:true as const,replicaCount:i.replicaCount,storedAt:i.storedAt.toISOString()};return signEnvelope({...m,receiptDigest:sha256(m)},i.signer);
}
export function createSignedIdempotentReplayReceiptV33_46(i:{signer:SigningIdentity;transactionPlanDigest:string;idempotencyKey:string;originalEntryDigest:string;originalSequence:number;duplicateCommandDigest:string;observedAt:Date}){
  const m={version:'33.46' as const,transactionPlanDigest:i.transactionPlanDigest,idempotencyKey:i.idempotencyKey,originalEntryDigest:i.originalEntryDigest,originalSequence:i.originalSequence,duplicateCommandDigest:i.duplicateCommandDigest,noNewJournalEntry:true as const,observedAt:i.observedAt.toISOString()};return signEnvelope({...m,receiptDigest:sha256(m)},i.signer);
}
export function createSignedTimeoutCompensationV33_46(i:{signer:SigningIdentity;transactionPlanDigest:string;timedOutEntryDigest:string;timeoutAt:Date;targetManifestDigest:string;decidedAt:Date}){
  const m={version:'33.46' as const,transactionPlanDigest:i.transactionPlanDigest,timedOutEntryDigest:i.timedOutEntryDigest,timeoutAt:i.timeoutAt.toISOString(),decision:'FULL_ROLLBACK_TO_BASE' as const,targetManifestDigest:i.targetManifestDigest,productionEffectsExecuted:0 as const,decidedAt:i.decidedAt.toISOString()};return signEnvelope({...m,compensationDigest:sha256(m)},i.signer);
}
export function createSignedCrashRecoveryReceiptV33_46(i:{signer:SigningIdentity;transactionPlanDigest:string;takeoverDigest:string;predecessorJournalHeadDigest:string;resumedSequence:number;resumedStage:CoordinatorStageV33_46;recoveringCoordinator:CoordinatorIdentityV33_46;recoveredAt:Date}){
  const m={version:'33.46' as const,transactionPlanDigest:i.transactionPlanDigest,takeoverDigest:i.takeoverDigest,predecessorJournalHeadDigest:i.predecessorJournalHeadDigest,resumedSequence:i.resumedSequence,resumedStage:i.resumedStage,recoveringCoordinator:i.recoveringCoordinator,noGap:true as const,noFork:true as const,recoveredAt:i.recoveredAt.toISOString()};return signEnvelope({...m,recoveryDigest:sha256(m)},i.signer);
}

const transitions:Record<CoordinatorStageV33_46,readonly CoordinatorStageV33_46[]>={
  PREPARED:['CANARY_STAGE_1_COMPLETED'],CANARY_STAGE_1_COMPLETED:['CANARY_STAGE_2_STARTED'],CANARY_STAGE_2_STARTED:['CANARY_STAGE_2_RESUMED'],CANARY_STAGE_2_RESUMED:['CANARY_STAGE_2_COMPLETED'],CANARY_STAGE_2_COMPLETED:['CANARY_STAGE_3_COMPLETED'],CANARY_STAGE_3_COMPLETED:['PROMOTION_PREPARED'],PROMOTION_PREPARED:['PROMOTION_RESUMED'],PROMOTION_RESUMED:['PROMOTION_COMMITTED'],PROMOTION_COMMITTED:[]};

export function verifyDurableTransactionCoordinatorV33_46(i:{
  baseVerdict:MultiPackageUpdateTransactionVerdictV33_45; policy:SignedEnvelope<CoordinatorPolicyPayloadV33_46>;
  initialLease:SignedEnvelope<CoordinatorLeasePayloadV33_46>; journalEntries:readonly SignedEnvelope<JournalEntryPayloadV33_46>[];
  takeoverVotes:readonly SignedEnvelope<TakeoverWitnessVotePayloadV33_46>[]; takeovers:readonly SignedEnvelope<CoordinatorTakeoverPayloadV33_46>[];
  durabilityReceipt:SignedEnvelope<DurableJournalReceiptPayloadV33_46>; replayReceipts:readonly SignedEnvelope<IdempotentReplayReceiptPayloadV33_46>[];
  timeoutCompensation:SignedEnvelope<TimeoutCompensationPayloadV33_46>; recoveryReceipts:readonly SignedEnvelope<CrashRecoveryReceiptPayloadV33_46>[];
  trust:DurableCoordinatorTrustV33_46; verifiedAt:Date;
}):DurableCoordinatorVerdictV33_46{
  const at=i.verifiedAt; if(i.baseVerdict.status!=='LOCAL_MULTI_PACKAGE_UPDATE_TRANSACTION_PROVEN'||i.baseVerdict.productionAuthority!=='NONE'||i.baseVerdict.externalEffectsExecuted!==0)throw new Error('coordinator_base_verdict_invalid');
  verifyEnvelope(i.policy,i.trust.policyRegistry,i.trust.trustedPolicySignerIds,at,'coordinator_policy_signature_invalid');assertDigest(i.policy.payload as unknown as Record<string,unknown>,'policyDigest','coordinator_policy_digest_invalid');if(i.policy.payload.transactionPlanDigest!==i.baseVerdict.transactionPlanDigest||i.policy.payload.takeoverWitnessQuorum!==3)throw new Error('coordinator_policy_contract_invalid');
  verifyEnvelope(i.initialLease,i.trust.leaseRegistry,i.trust.trustedLeaseSignerIds,at,'coordinator_lease_signature_invalid');assertDigest(i.initialLease.payload as unknown as Record<string,unknown>,'leaseDigest','coordinator_lease_digest_invalid');if(i.initialLease.payload.transactionPlanDigest!==i.baseVerdict.transactionPlanDigest||i.initialLease.payload.term!==1||i.initialLease.payload.sequenceStart!==1||i.initialLease.payload.sequenceEnd<9)throw new Error('coordinator_initial_lease_invalid');
  if(i.takeovers.length!==2||i.takeoverVotes.length!==6)throw new Error('coordinator_takeover_inventory_invalid');
  const authorities:[string,CoordinatorIdentityV33_46,number,number,string][]=[[i.initialLease.payload.leaseDigest,i.initialLease.payload.coordinator,1,1,i.initialLease.payload.expiresAt]];
  let predecessorAuthority=i.initialLease.payload.leaseDigest;let predecessorTerm=1;let predecessorIdentity=i.initialLease.payload.coordinator;let expectedFence=4;
  for(let t=0;t<i.takeovers.length;t++){
    const takeover=i.takeovers[t]!;verifyEnvelope(takeover,i.trust.takeoverRegistry,i.trust.trustedTakeoverSignerIds,at,'coordinator_takeover_signature_invalid');assertDigest(takeover.payload as unknown as Record<string,unknown>,'takeoverDigest','coordinator_takeover_digest_invalid');
    if(takeover.payload.transactionPlanDigest!==i.baseVerdict.transactionPlanDigest||takeover.payload.predecessorAuthorityDigest!==predecessorAuthority||takeover.payload.predecessorTerm!==predecessorTerm||takeover.payload.successorTerm!==predecessorTerm+1||takeover.payload.fenceSequence!==expectedFence||identityKey(takeover.payload.successor)===identityKey(predecessorIdentity))throw new Error('coordinator_takeover_contract_invalid');
    const votes=i.takeoverVotes.filter(v=>takeover.payload.voteDigests.includes(v.payload.voteDigest));if(votes.length!==3)throw new Error('coordinator_takeover_vote_quorum_invalid');const orgs=new Set<string>(),hosts=new Set<string>(),keys=new Set<string>();
    for(const vote of votes){verifyEnvelope(vote,i.trust.witnessRegistry,i.trust.trustedWitnessIds,at,'coordinator_takeover_vote_signature_invalid');assertDigest(vote.payload as unknown as Record<string,unknown>,'voteDigest','coordinator_takeover_vote_digest_invalid');if(vote.payload.transactionPlanDigest!==i.baseVerdict.transactionPlanDigest||vote.payload.predecessorAuthorityDigest!==predecessorAuthority||vote.payload.predecessorTerm!==predecessorTerm||vote.payload.successorTerm!==predecessorTerm+1||vote.payload.fenceSequence!==expectedFence||identityKey(vote.payload.successor)!==identityKey(takeover.payload.successor))throw new Error('coordinator_takeover_vote_contract_invalid');orgs.add(vote.payload.witnessOrganization);hosts.add(vote.payload.witnessHost);keys.add(vote.issuerKeyId);}
    if(orgs.size!==3||hosts.size!==3||keys.size!==3)throw new Error('coordinator_takeover_witnesses_not_independent');
    const expiry=t===0?iso(i.initialLease.payload.expiresAt,'lease_expiry_invalid'):iso(i.takeovers[t-1]!.payload.effectiveAt,'takeover_effective_invalid');const min=expiry+i.policy.payload.expirySafetyDelayMs;if(votes.some(v=>iso(v.payload.observedExpiredAt,'vote_expiry_invalid')<min)||iso(takeover.payload.effectiveAt,'takeover_effective_invalid')<min)throw new Error('coordinator_takeover_too_early');
    authorities.push([takeover.payload.takeoverDigest,takeover.payload.successor,takeover.payload.successorTerm,expectedFence,takeover.payload.effectiveAt]);predecessorAuthority=takeover.payload.takeoverDigest;predecessorTerm=takeover.payload.successorTerm;predecessorIdentity=takeover.payload.successor;expectedFence=8;
  }
  if(i.journalEntries.length!==9)throw new Error('coordinator_journal_entry_count_invalid');let prev:string|null=null;let prevStage:CoordinatorStageV33_46|undefined;const idempotency=new Map<string,SignedEnvelope<JournalEntryPayloadV33_46>>();
  for(let idx=0;idx<i.journalEntries.length;idx++){const e=i.journalEntries[idx]!;verifyEnvelope(e,i.trust.coordinatorRegistry,i.trust.trustedCoordinatorIds,at,'coordinator_journal_signature_invalid');assertDigest(e.payload as unknown as Record<string,unknown>,'entryDigest','coordinator_journal_digest_invalid');if(e.payload.sequence!==idx+1||e.payload.transactionPlanDigest!==i.baseVerdict.transactionPlanDigest||e.payload.policyDigest!==i.policy.payload.policyDigest||e.payload.predecessorEntryDigest!==prev)throw new Error('coordinator_journal_chain_invalid');if(idempotency.has(e.payload.idempotencyKey))throw new Error('coordinator_duplicate_journal_idempotency_key');
    const authority=e.payload.term===1?authorities[0]:e.payload.term===2?authorities[1]:authorities[2];if(!authority||e.payload.authorityDigest!==authority[0]||identityKey(e.payload.coordinator)!==identityKey(authority[1])||e.issuerKeyId!==authority[1].keyId||e.payload.sequence<authority[3])throw new Error('coordinator_fencing_invalid');if(e.payload.term===1&&e.payload.sequence>=4||e.payload.term===2&&(e.payload.sequence<4||e.payload.sequence>=8)||e.payload.term===3&&e.payload.sequence<8)throw new Error('coordinator_term_sequence_invalid');if(prevStage!==undefined&&!transitions[prevStage].includes(e.payload.stage))throw new Error('coordinator_stage_transition_invalid');prev=e.payload.entryDigest;prevStage=e.payload.stage;idempotency.set(e.payload.idempotencyKey,e);}
  if(prevStage!=='PROMOTION_COMMITTED')throw new Error('coordinator_terminal_stage_invalid');
  verifyEnvelope(i.durabilityReceipt,i.trust.storageRegistry,i.trust.trustedStorageSignerIds,at,'coordinator_storage_signature_invalid');assertDigest(i.durabilityReceipt.payload as unknown as Record<string,unknown>,'receiptDigest','coordinator_storage_digest_invalid');const entryDigests=i.journalEntries.map(e=>e.payload.entryDigest);if(JSON.stringify(i.durabilityReceipt.payload.entryDigests)!==JSON.stringify(entryDigests)||i.durabilityReceipt.payload.journalHeadDigest!==entryDigests.at(-1)||!i.durabilityReceipt.payload.fileFsync||!i.durabilityReceipt.payload.directoryFsync||i.durabilityReceipt.payload.replicaCount<i.policy.payload.minimumDurableReplicas)throw new Error('coordinator_storage_contract_invalid');
  if(i.replayReceipts.length!==2)throw new Error('coordinator_replay_receipt_count_invalid');for(const r of i.replayReceipts){verifyEnvelope(r,i.trust.replayRegistry,i.trust.trustedReplaySignerIds,at,'coordinator_replay_signature_invalid');assertDigest(r.payload as unknown as Record<string,unknown>,'receiptDigest','coordinator_replay_digest_invalid');const original=idempotency.get(r.payload.idempotencyKey);if(!original||r.payload.originalEntryDigest!==original.payload.entryDigest||r.payload.originalSequence!==original.payload.sequence||!r.payload.noNewJournalEntry)throw new Error('coordinator_replay_contract_invalid');}
  verifyEnvelope(i.timeoutCompensation,i.trust.compensationRegistry,i.trust.trustedCompensationSignerIds,at,'coordinator_compensation_signature_invalid');assertDigest(i.timeoutCompensation.payload as unknown as Record<string,unknown>,'compensationDigest','coordinator_compensation_digest_invalid');const timed=i.journalEntries.find(e=>e.payload.entryDigest===i.timeoutCompensation.payload.timedOutEntryDigest);if(!timed||iso(i.timeoutCompensation.payload.timeoutAt,'compensation_timeout_invalid')<iso(timed.payload.eventTime,'entry_time_invalid')+i.policy.payload.commandTimeoutMs||i.timeoutCompensation.payload.targetManifestDigest!==i.baseVerdict.basePlannerVerdictDigest||i.timeoutCompensation.payload.productionEffectsExecuted!==0)throw new Error('coordinator_compensation_contract_invalid');
  if(i.recoveryReceipts.length!==2)throw new Error('coordinator_recovery_receipt_count_invalid');for(let n=0;n<2;n++){const r=i.recoveryReceipts[n]!,takeover=i.takeovers[n]!,resumed=i.journalEntries[takeover.payload.fenceSequence-1]!,head=i.journalEntries[takeover.payload.fenceSequence-2]!;verifyEnvelope(r,i.trust.recoveryRegistry,i.trust.trustedRecoverySignerIds,at,'coordinator_recovery_signature_invalid');assertDigest(r.payload as unknown as Record<string,unknown>,'recoveryDigest','coordinator_recovery_digest_invalid');if(r.payload.takeoverDigest!==takeover.payload.takeoverDigest||r.payload.predecessorJournalHeadDigest!==head.payload.entryDigest||r.payload.resumedSequence!==takeover.payload.fenceSequence||r.payload.resumedSequence!==resumed.payload.sequence||r.payload.resumedStage!==resumed.payload.stage||identityKey(r.payload.recoveringCoordinator)!==identityKey(takeover.payload.successor)||!r.payload.noGap||!r.payload.noFork)throw new Error('coordinator_recovery_contract_invalid');}
  const m={version:'33.46' as const,status:'LOCAL_DURABLE_TRANSACTION_COORDINATOR_FAILOVER_PROVEN' as const,baseTransactionVerdictDigest:i.baseVerdict.verdictDigest,policyDigest:i.policy.payload.policyDigest,initialLeaseDigest:i.initialLease.payload.leaseDigest,takeoverDigests:i.takeovers.map(t=>t.payload.takeoverDigest),journalHeadDigest:entryDigests.at(-1)!,durabilityReceiptDigest:i.durabilityReceipt.payload.receiptDigest,replayReceiptDigests:i.replayReceipts.map(r=>r.payload.receiptDigest),timeoutCompensationDigest:i.timeoutCompensation.payload.compensationDigest,recoveryDigests:i.recoveryReceipts.map(r=>r.payload.recoveryDigest),journalEntryCount:i.journalEntries.length,coordinatorTermCount:3,takeoverCount:2,replayReceiptCount:i.replayReceipts.length,crashRecoveryCount:i.recoveryReceipts.length,monotonicJournalProven:true as const,irreversibleFencingProven:true as const,idempotentReplayProven:true as const,timeoutCompensationProven:true as const,multiProcessFailoverProven:true as const,updatePromoted:false as const,externalCoordinatorHostsObserved:false as const,externalHumanParticipants:0 as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const,verifiedAt:i.verifiedAt.toISOString()};return {...m,verdictDigest:sha256(m)};
}
