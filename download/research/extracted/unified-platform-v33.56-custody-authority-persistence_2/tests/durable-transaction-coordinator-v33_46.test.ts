import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../src/contracts/crypto.js';
import {
  createSignedCoordinatorLeaseV33_46, createSignedCoordinatorPolicyV33_46, createSignedCoordinatorTakeoverV33_46,
  createSignedCrashRecoveryReceiptV33_46, createSignedDurableJournalReceiptV33_46, createSignedIdempotentReplayReceiptV33_46,
  createSignedJournalEntryV33_46, createSignedTakeoverWitnessVoteV33_46, createSignedTimeoutCompensationV33_46,
  verifyDurableTransactionCoordinatorV33_46, type CoordinatorIdentityV33_46, type CoordinatorStageV33_46,
  type DurableCoordinatorTrustV33_46,
} from '../src/supply-chain/durable-transaction-coordinator-v33_46.js';
import type { MultiPackageUpdateTransactionVerdictV33_45 } from '../src/supply-chain/multi-package-update-transaction-v33_45.js';

const now=new Date('2026-07-24T00:00:00.000Z');
const at=(ms:number)=>new Date(now.getTime()+ms);
const registry=(ids:ReturnType<typeof generateSigningIdentity>[])=>{const r=new KeyRegistry();for(const id of ids)r.register(id.keyId,id.publicKey);return r;};
function baseVerdict():MultiPackageUpdateTransactionVerdictV33_45{const m={version:'33.45' as const,status:'LOCAL_MULTI_PACKAGE_UPDATE_TRANSACTION_PROVEN' as const,basePlannerVerdictDigest:sha256({base:44}),policyDigest:sha256({p:45}),transactionPlanDigest:sha256({t:45}),resolutionDigest:sha256({r:45}),rehearsalDigest:sha256({x:45}),approvalCertificateDigest:sha256({a:45}),canaryPlanDigest:sha256({c:45}),promotionDigest:sha256({pr:45}),partialRollbackDecisionDigest:sha256({pa:45}),fullRollbackDecisionDigest:sha256({fu:45}),interruptionRecoveryDigest:sha256({ir:45}),retentionLedgerDigest:sha256({rl:45}),packageCount:3,approvalCount:3,canaryStageCount:3,canaryMonitorCount:3,retainedGenerationCount:4,atomicTransactionProven:true as const,conflictResolutionProven:true as const,stagedCanaryProven:true as const,promotionSuccessPathProven:true as const,rollbackClassificationProven:true as const,interruptionRecoveryProven:true as const,updatePromoted:false as const,externalPackageArtifactsObserved:false as const,externalCanaryTrafficObserved:false as const,externalHumanParticipants:0 as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const,verifiedAt:at(-1000).toISOString()};return{...m,verdictDigest:sha256(m)};}
function setup(){
  const ids={policy:generateSigningIdentity('v33.46-policy'),lease:generateSigningIdentity('v33.46-lease'),coordinators:[generateSigningIdentity('v33.46-coordinator-a'),generateSigningIdentity('v33.46-coordinator-b'),generateSigningIdentity('v33.46-coordinator-c')],witnesses:[generateSigningIdentity('v33.46-witness-1'),generateSigningIdentity('v33.46-witness-2'),generateSigningIdentity('v33.46-witness-3')],takeover:generateSigningIdentity('v33.46-takeover-authority'),storage:generateSigningIdentity('v33.46-storage'),replay:generateSigningIdentity('v33.46-replay'),compensation:generateSigningIdentity('v33.46-compensation'),recovery:generateSigningIdentity('v33.46-recovery')};
  const base=baseVerdict();
  const coordinators:CoordinatorIdentityV33_46[]=ids.coordinators.map((x,n)=>({keyId:x.keyId,organization:`Coordinator Org ${n+1}`,host:`coord-${n+1}.local.fixture`}));
  const policy=createSignedCoordinatorPolicyV33_46({signer:ids.policy,transactionPlanDigest:base.transactionPlanDigest,expirySafetyDelayMs:1000,commandTimeoutMs:5000,generatedAt:at(0)});
  const initialLease=createSignedCoordinatorLeaseV33_46({signer:ids.lease,transactionPlanDigest:base.transactionPlanDigest,coordinator:coordinators[0]!,term:1,sequenceStart:1,sequenceEnd:20,issuedAt:at(1000),expiresAt:at(10_000)});
  const votes1=ids.witnesses.map((signer,n)=>createSignedTakeoverWitnessVoteV33_46({signer,transactionPlanDigest:base.transactionPlanDigest,predecessorAuthorityDigest:initialLease.payload.leaseDigest,predecessorTerm:1,successorTerm:2,successor:coordinators[1]!,fenceSequence:4,observedExpiredAt:at(11_000+n),witnessOrganization:`Witness Org ${n+1}`,witnessHost:`witness-${n+1}.fixture`}));
  const takeover1=createSignedCoordinatorTakeoverV33_46({signer:ids.takeover,transactionPlanDigest:base.transactionPlanDigest,predecessorAuthorityDigest:initialLease.payload.leaseDigest,predecessorTerm:1,successorTerm:2,successor:coordinators[1]!,fenceSequence:4,voteDigests:votes1.map(v=>v.payload.voteDigest),effectiveAt:at(12_000)});
  const votes2=ids.witnesses.map((signer,n)=>createSignedTakeoverWitnessVoteV33_46({signer,transactionPlanDigest:base.transactionPlanDigest,predecessorAuthorityDigest:takeover1.payload.takeoverDigest,predecessorTerm:2,successorTerm:3,successor:coordinators[2]!,fenceSequence:8,observedExpiredAt:at(13_000+n),witnessOrganization:`Witness Org ${n+1}`,witnessHost:`witness-${n+1}.fixture`}));
  const takeover2=createSignedCoordinatorTakeoverV33_46({signer:ids.takeover,transactionPlanDigest:base.transactionPlanDigest,predecessorAuthorityDigest:takeover1.payload.takeoverDigest,predecessorTerm:2,successorTerm:3,successor:coordinators[2]!,fenceSequence:8,voteDigests:votes2.map(v=>v.payload.voteDigest),effectiveAt:at(14_000)});
  const stages:CoordinatorStageV33_46[]=['PREPARED','CANARY_STAGE_1_COMPLETED','CANARY_STAGE_2_STARTED','CANARY_STAGE_2_RESUMED','CANARY_STAGE_2_COMPLETED','CANARY_STAGE_3_COMPLETED','PROMOTION_PREPARED','PROMOTION_RESUMED','PROMOTION_COMMITTED'];
  const journalEntries=[];let predecessor:null|string=null;
  for(let idx=0;idx<9;idx++){const term=idx<3?1:idx<7?2:3;const ci=term-1;const authority=term===1?initialLease.payload.leaseDigest:term===2?takeover1.payload.takeoverDigest:takeover2.payload.takeoverDigest;const e=createSignedJournalEntryV33_46({signer:ids.coordinators[ci]!,transactionPlanDigest:base.transactionPlanDigest,policyDigest:policy.payload.policyDigest,term,sequence:idx+1,coordinator:coordinators[ci]!,authorityDigest:authority,stage:stages[idx]!,commandId:`command-${idx+1}`,idempotencyKey:`idem-${idx+1}`,predecessorEntryDigest:predecessor,eventTime:at(2000+idx*1000)});journalEntries.push(e);predecessor=e.payload.entryDigest;}
  const bytes=Buffer.from(journalEntries.map(e=>JSON.stringify(e.payload)).join('\n')+'\n');
  const durabilityReceipt=createSignedDurableJournalReceiptV33_46({signer:ids.storage,transactionPlanDigest:base.transactionPlanDigest,entryDigests:journalEntries.map(e=>e.payload.entryDigest),journalHeadDigest:journalEntries.at(-1)!.payload.entryDigest,byteLength:bytes.length,replicaCount:1,storedAt:at(20_000)});
  const replayReceipts=[journalEntries[3]!,journalEntries[7]!].map((e,n)=>createSignedIdempotentReplayReceiptV33_46({signer:ids.replay,transactionPlanDigest:base.transactionPlanDigest,idempotencyKey:e.payload.idempotencyKey,originalEntryDigest:e.payload.entryDigest,originalSequence:e.payload.sequence,duplicateCommandDigest:sha256({duplicate:n}),observedAt:at(21_000+n)}));
  const timeoutCompensation=createSignedTimeoutCompensationV33_46({signer:ids.compensation,transactionPlanDigest:base.transactionPlanDigest,timedOutEntryDigest:journalEntries[2]!.payload.entryDigest,timeoutAt:at(15_000),targetManifestDigest:base.basePlannerVerdictDigest,decidedAt:at(15_100)});
  const recoveryReceipts=[
    createSignedCrashRecoveryReceiptV33_46({signer:ids.recovery,transactionPlanDigest:base.transactionPlanDigest,takeoverDigest:takeover1.payload.takeoverDigest,predecessorJournalHeadDigest:journalEntries[2]!.payload.entryDigest,resumedSequence:4,resumedStage:'CANARY_STAGE_2_RESUMED',recoveringCoordinator:coordinators[1]!,recoveredAt:at(12_100)}),
    createSignedCrashRecoveryReceiptV33_46({signer:ids.recovery,transactionPlanDigest:base.transactionPlanDigest,takeoverDigest:takeover2.payload.takeoverDigest,predecessorJournalHeadDigest:journalEntries[6]!.payload.entryDigest,resumedSequence:8,resumedStage:'PROMOTION_RESUMED',recoveringCoordinator:coordinators[2]!,recoveredAt:at(14_100)}),
  ];
  const trust:DurableCoordinatorTrustV33_46={policyRegistry:registry([ids.policy]),trustedPolicySignerIds:[ids.policy.keyId],leaseRegistry:registry([ids.lease]),trustedLeaseSignerIds:[ids.lease.keyId],coordinatorRegistry:registry(ids.coordinators),trustedCoordinatorIds:ids.coordinators.map(x=>x.keyId),witnessRegistry:registry(ids.witnesses),trustedWitnessIds:ids.witnesses.map(x=>x.keyId),takeoverRegistry:registry([ids.takeover]),trustedTakeoverSignerIds:[ids.takeover.keyId],storageRegistry:registry([ids.storage]),trustedStorageSignerIds:[ids.storage.keyId],replayRegistry:registry([ids.replay]),trustedReplaySignerIds:[ids.replay.keyId],compensationRegistry:registry([ids.compensation]),trustedCompensationSignerIds:[ids.compensation.keyId],recoveryRegistry:registry([ids.recovery]),trustedRecoverySignerIds:[ids.recovery.keyId]};
  const args={baseVerdict:base,policy,initialLease,journalEntries,takeoverVotes:[...votes1,...votes2],takeovers:[takeover1,takeover2],durabilityReceipt,replayReceipts,timeoutCompensation,recoveryReceipts,trust,verifiedAt:at(30_000)};
  return{ids,coordinators,args};
}

test('v33.46 valid durable failover transaction',()=>{const {args}=setup();const v=verifyDurableTransactionCoordinatorV33_46(args);assert.equal(v.status,'LOCAL_DURABLE_TRANSACTION_COORDINATOR_FAILOVER_PROVEN');assert.equal(v.journalEntryCount,9);assert.equal(v.takeoverCount,2);});

const attacks:[string,(s:ReturnType<typeof setup>)=>unknown][]=[
  ['rejects invalid base status',s=>({...s.args,baseVerdict:{...s.args.baseVerdict,status:'BROKEN'}})],
  ['rejects policy tamper',s=>({...s.args,policy:{...s.args.policy,payload:{...s.args.policy.payload,commandTimeoutMs:1}}})],
  ['rejects lease tamper',s=>({...s.args,initialLease:{...s.args.initialLease,payload:{...s.args.initialLease.payload,sequenceEnd:8}}})],
  ['rejects missing takeover',s=>({...s.args,takeovers:s.args.takeovers.slice(0,1)})],
  ['rejects missing witness votes',s=>({...s.args,takeoverVotes:s.args.takeoverVotes.slice(0,5)})],
  ['rejects early witness observation',s=>{const v=s.args.takeoverVotes[0]!;return{...s.args,takeoverVotes:[{...v,payload:{...v.payload,observedExpiredAt:at(10_500).toISOString()}},...s.args.takeoverVotes.slice(1)]};}],
  ['rejects early takeover',s=>{const t=s.args.takeovers[0]!;return{...s.args,takeovers:[{...t,payload:{...t.payload,effectiveAt:at(10_500).toISOString()}},s.args.takeovers[1]!]};}],
  ['rejects successor identity reuse',s=>{const t=s.args.takeovers[0]!;return{...s.args,takeovers:[{...t,payload:{...t.payload,successor:s.coordinators[0]!}},s.args.takeovers[1]!]};}],
  ['rejects fence sequence drift',s=>{const t=s.args.takeovers[0]!;return{...s.args,takeovers:[{...t,payload:{...t.payload,fenceSequence:5}},s.args.takeovers[1]!]};}],
  ['rejects witness org duplication',s=>{const a=s.args.takeoverVotes[0]!,b=s.args.takeoverVotes[1]!;return{...s.args,takeoverVotes:[a,{...b,payload:{...b.payload,witnessOrganization:a.payload.witnessOrganization}},...s.args.takeoverVotes.slice(2)]};}],
  ['rejects witness host duplication',s=>{const a=s.args.takeoverVotes[0]!,b=s.args.takeoverVotes[1]!;return{...s.args,takeoverVotes:[a,{...b,payload:{...b.payload,witnessHost:a.payload.witnessHost}},...s.args.takeoverVotes.slice(2)]};}],
  ['rejects journal truncation',s=>({...s.args,journalEntries:s.args.journalEntries.slice(0,8)})],
  ['rejects journal sequence gap',s=>{const e=s.args.journalEntries[4]!;const arr=[...s.args.journalEntries];arr[4]={...e,payload:{...e.payload,sequence:6}};return{...s.args,journalEntries:arr};}],
  ['rejects journal predecessor fork',s=>{const e=s.args.journalEntries[4]!;const arr=[...s.args.journalEntries];arr[4]={...e,payload:{...e.payload,predecessorEntryDigest:sha256({fork:true})}};return{...s.args,journalEntries:arr};}],
  ['rejects old coordinator resurrection',s=>{const e=s.args.journalEntries[3]!;const arr=[...s.args.journalEntries];arr[3]={...e,issuerKeyId:s.ids.coordinators[0]!.keyId,payload:{...e.payload,coordinator:s.coordinators[0]!}};return{...s.args,journalEntries:arr};}],
  ['rejects wrong authority token',s=>{const e=s.args.journalEntries[3]!;const arr=[...s.args.journalEntries];arr[3]={...e,payload:{...e.payload,authorityDigest:s.args.initialLease.payload.leaseDigest}};return{...s.args,journalEntries:arr};}],
  ['rejects wrong term',s=>{const e=s.args.journalEntries[7]!;const arr=[...s.args.journalEntries];arr[7]={...e,payload:{...e.payload,term:2}};return{...s.args,journalEntries:arr};}],
  ['rejects stage skip',s=>{const e=s.args.journalEntries[4]!;const arr=[...s.args.journalEntries];arr[4]={...e,payload:{...e.payload,stage:'PROMOTION_PREPARED'}};return{...s.args,journalEntries:arr};}],
  ['rejects duplicate idempotency in journal',s=>{const e=s.args.journalEntries[4]!;const arr=[...s.args.journalEntries];arr[4]={...e,payload:{...e.payload,idempotencyKey:s.args.journalEntries[3]!.payload.idempotencyKey}};return{...s.args,journalEntries:arr};}],
  ['rejects bad storage entry list',s=>({...s.args,durabilityReceipt:{...s.args.durabilityReceipt,payload:{...s.args.durabilityReceipt.payload,entryDigests:s.args.durabilityReceipt.payload.entryDigests.slice(0,8)}}})],
  ['rejects bad storage head',s=>({...s.args,durabilityReceipt:{...s.args.durabilityReceipt,payload:{...s.args.durabilityReceipt.payload,journalHeadDigest:sha256({wrong:true})}}})],
  ['rejects no storage replica',s=>({...s.args,durabilityReceipt:{...s.args.durabilityReceipt,payload:{...s.args.durabilityReceipt.payload,replicaCount:0}}})],
  ['rejects missing replay receipt',s=>({...s.args,replayReceipts:s.args.replayReceipts.slice(0,1)})],
  ['rejects replay wrong original',s=>{const r=s.args.replayReceipts[0]!;return{...s.args,replayReceipts:[{...r,payload:{...r.payload,originalEntryDigest:sha256({wrong:true})}},s.args.replayReceipts[1]!]};}],
  ['rejects replay wrong sequence',s=>{const r=s.args.replayReceipts[0]!;return{...s.args,replayReceipts:[{...r,payload:{...r.payload,originalSequence:99}},s.args.replayReceipts[1]!]};}],
  ['rejects timeout before deadline',s=>({...s.args,timeoutCompensation:{...s.args.timeoutCompensation,payload:{...s.args.timeoutCompensation.payload,timeoutAt:at(7000).toISOString()}}})],
  ['rejects compensation target drift',s=>({...s.args,timeoutCompensation:{...s.args.timeoutCompensation,payload:{...s.args.timeoutCompensation.payload,targetManifestDigest:sha256({wrong:true})}}})],
  ['rejects missing recovery receipt',s=>({...s.args,recoveryReceipts:s.args.recoveryReceipts.slice(0,1)})],
  ['rejects recovery sequence gap',s=>{const r=s.args.recoveryReceipts[0]!;return{...s.args,recoveryReceipts:[{...r,payload:{...r.payload,resumedSequence:5}},s.args.recoveryReceipts[1]!]};}],
  ['rejects recovery wrong journal head',s=>{const r=s.args.recoveryReceipts[0]!;return{...s.args,recoveryReceipts:[{...r,payload:{...r.payload,predecessorJournalHeadDigest:sha256({wrong:true})}},s.args.recoveryReceipts[1]!]};}],
  ['rejects recovery wrong coordinator',s=>{const r=s.args.recoveryReceipts[0]!;return{...s.args,recoveryReceipts:[{...r,payload:{...r.payload,recoveringCoordinator:s.coordinators[2]!}},s.args.recoveryReceipts[1]!]};}],
  ['rejects forged journal signature',s=>{const e=s.args.journalEntries[0]!;const arr=[...s.args.journalEntries];arr[0]=signEnvelope(e.payload,s.ids.replay);return{...s.args,journalEntries:arr};}],
  ['rejects forged takeover signature',s=>{const t=s.args.takeovers[0]!;return{...s.args,takeovers:[signEnvelope(t.payload,s.ids.replay),s.args.takeovers[1]!]};}],
  ['rejects forged storage signature',s=>({...s.args,durabilityReceipt:signEnvelope(s.args.durabilityReceipt.payload,s.ids.replay)})],
  ['rejects production authority mutation',s=>({...s.args,baseVerdict:{...s.args.baseVerdict,productionAuthority:'PRODUCTION'}})],
];
for(const [name,mutate] of attacks)test(name,()=>{const s=setup();assert.throws(()=>verifyDurableTransactionCoordinatorV33_46(mutate(s) as Parameters<typeof verifyDurableTransactionCoordinatorV33_46>[0]));});
