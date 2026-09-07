import { KeyRegistry, sha256, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { DependencyUpdatePlannerVerdictV33_44 } from './dependency-update-planner-v33_44.js';

export type TransactionApprovalRoleV33_45 = 'SECURITY'|'RELEASE'|'OPERATIONS';
export type RollbackModeV33_45 = 'PARTIAL'|'FULL';
export type CanaryStageV33_45 = 'STAGE_1'|'STAGE_2'|'STAGE_3';

export interface TransactionPolicyPayloadV33_45 {
  readonly version:'33.45'; readonly policyId:string; readonly sequence:1; readonly predecessorPolicyDigest:null;
  readonly minPackages:number; readonly maxPackages:number; readonly requireAtomicCommit:true; readonly minimumIndependentApprovals:3;
  readonly requiredApprovalRoles:readonly TransactionApprovalRoleV33_45[]; readonly canaryStages:readonly number[];
  readonly holdbackPercent:number; readonly minimumSamplesPerStage:number; readonly maximumErrorRateBps:number;
  readonly maximumRegressionCount:number; readonly minimumRetainedGenerations:number; readonly generatedAt:string; readonly policyDigest:string;
}
export interface PackageMutationV33_45 {
  readonly packageName:string; readonly currentVersion:string; readonly targetVersion:string; readonly artifactDigest:string;
  readonly provenanceDigest:string; readonly compatibilityGroup:string; readonly directDependencies:readonly string[];
  readonly reversible:true; readonly stateMigration:false; readonly mutationDigest:string;
}
export interface TransactionPlanPayloadV33_45 {
  readonly version:'33.45'; readonly transactionId:string; readonly policyDigest:string; readonly baseManifestDigest:string;
  readonly packageMutations:readonly PackageMutationV33_45[]; readonly packageCount:number; readonly transactionManifestDigest:string;
  readonly plannedAt:string; readonly planDigest:string;
}
export interface ConflictResolutionPayloadV33_45 {
  readonly version:'33.45'; readonly transactionPlanDigest:string; readonly dependencyGraphDigest:string;
  readonly conflictCount:number; readonly resolvedConflictCount:number; readonly unresolvedConflictCount:0;
  readonly atomicCompatibilityGroups:readonly string[]; readonly resolutionRules:readonly string[];
  readonly analyzedAt:string; readonly resolutionDigest:string;
}
export interface TransactionRehearsalPayloadV33_45 {
  readonly version:'33.45'; readonly transactionPlanDigest:string; readonly resolutionDigest:string;
  readonly command:'npm ci --offline && npm run build && node --test'; readonly cacheInitiallyEmpty:true;
  readonly networkRequestsObserved:0; readonly installExitCode:0; readonly buildExitCode:0;
  readonly testCount:number; readonly testFailures:0; readonly compatibilityFailures:0;
  readonly interruptedUpdateRecoveryTested:true; readonly partialRollbackScenarioTested:true; readonly fullRollbackScenarioTested:true;
  readonly rehearsalLogDigest:string; readonly completedAt:string; readonly rehearsalDigest:string;
}
export interface TransactionApprovalVotePayloadV33_45 {
  readonly version:'33.45'; readonly transactionPlanDigest:string; readonly rehearsalDigest:string;
  readonly role:TransactionApprovalRoleV33_45; readonly organization:string; readonly decision:'APPROVE';
  readonly votedAt:string; readonly voteDigest:string;
}
export interface TransactionApprovalCertificatePayloadV33_45 {
  readonly version:'33.45'; readonly policyDigest:string; readonly transactionPlanDigest:string; readonly rehearsalDigest:string;
  readonly voteDigests:readonly string[]; readonly issuedAt:string; readonly certificateDigest:string;
}
export interface StagedCanaryPlanPayloadV33_45 {
  readonly version:'33.45'; readonly transactionPlanDigest:string; readonly approvalCertificateDigest:string;
  readonly stagePercents:readonly number[]; readonly holdbackPercent:number; readonly minimumSamplesPerStage:number;
  readonly maximumErrorRateBps:number; readonly maximumRegressionCount:number; readonly cohortDigest:string;
  readonly startedAt:string; readonly planDigest:string;
}
export interface StagedCanaryReportPayloadV33_45 {
  readonly version:'33.45'; readonly planDigest:string; readonly transactionPlanDigest:string; readonly stage:CanaryStageV33_45;
  readonly stagePercent:number; readonly monitorOrganization:string; readonly sampleCount:number; readonly errorCount:number;
  readonly regressionCount:number; readonly observedAt:string; readonly reportDigest:string;
}
export interface PromotionCertificatePayloadV33_45 {
  readonly version:'33.45'; readonly policyDigest:string; readonly transactionPlanDigest:string; readonly planDigest:string;
  readonly reportDigests:readonly string[]; readonly totalSamples:number; readonly totalErrors:number; readonly totalRegressions:number;
  readonly errorRateBps:number; readonly decision:'PROMOTION_ELIGIBLE_LOCAL_REHEARSAL_ONLY'; readonly issuedAt:string;
  readonly promotionDigest:string;
}
export interface RollbackDecisionPayloadV33_45 {
  readonly version:'33.45'; readonly transactionPlanDigest:string; readonly scenarioId:string;
  readonly failedPackages:readonly string[]; readonly coupledCompatibilityGroups:readonly string[];
  readonly decision:RollbackModeV33_45; readonly reason:'ISOLATED_REVERSIBLE_FAILURE'|'ATOMIC_GROUP_OR_UNKNOWN_STATE';
  readonly decidedAt:string; readonly decisionDigest:string;
}
export interface InterruptedTransactionCheckpointPayloadV33_45 {
  readonly version:'33.45'; readonly transactionPlanDigest:string; readonly sequence:number; readonly stage:'APPLYING';
  readonly appliedPackages:readonly string[]; readonly pendingPackages:readonly string[]; readonly durableJournalDigest:string;
  readonly recordedAt:string; readonly checkpointDigest:string;
}
export interface InterruptedTransactionRecoveryPayloadV33_45 {
  readonly version:'33.45'; readonly transactionPlanDigest:string; readonly checkpointDigest:string;
  readonly recoveryMode:'FULL_ROLLBACK_TO_BASE'; readonly restoredManifestDigest:string; readonly resumedSequence:number;
  readonly forkDetected:false; readonly partialStateRemaining:false; readonly recoveredAt:string; readonly recoveryDigest:string;
}
export interface TransactionGenerationV33_45 {
  readonly sequence:number; readonly manifestDigest:string; readonly artifactDigest:string;
  readonly status:'ACTIVE'|'ROLLBACK_READY'|'CANDIDATE'|'RECOVERY_BASE';
}
export interface MultiGenerationRetentionPayloadV33_45 {
  readonly version:'33.45'; readonly sequence:1; readonly predecessorLedgerDigest:null; readonly activeManifestDigest:string;
  readonly generations:readonly TransactionGenerationV33_45[]; readonly recordedAt:string; readonly ledgerDigest:string;
}
export interface MultiPackageUpdateTransactionVerdictV33_45 {
  readonly version:'33.45'; readonly status:'LOCAL_MULTI_PACKAGE_UPDATE_TRANSACTION_PROVEN';
  readonly basePlannerVerdictDigest:string; readonly policyDigest:string; readonly transactionPlanDigest:string;
  readonly resolutionDigest:string; readonly rehearsalDigest:string; readonly approvalCertificateDigest:string;
  readonly canaryPlanDigest:string; readonly promotionDigest:string; readonly partialRollbackDecisionDigest:string;
  readonly fullRollbackDecisionDigest:string; readonly interruptionRecoveryDigest:string; readonly retentionLedgerDigest:string;
  readonly packageCount:number; readonly approvalCount:number; readonly canaryStageCount:number; readonly canaryMonitorCount:number;
  readonly retainedGenerationCount:number; readonly atomicTransactionProven:true; readonly conflictResolutionProven:true;
  readonly stagedCanaryProven:true; readonly promotionSuccessPathProven:true; readonly rollbackClassificationProven:true;
  readonly interruptionRecoveryProven:true; readonly updatePromoted:false; readonly externalPackageArtifactsObserved:false;
  readonly externalCanaryTrafficObserved:false; readonly externalHumanParticipants:0; readonly productionAuthority:'NONE';
  readonly externalEffectsExecuted:0; readonly verifiedAt:string; readonly verdictDigest:string;
}
export interface MultiPackageUpdateTransactionTrustV33_45 {
  readonly policyRegistry:KeyRegistry; readonly trustedPolicySignerIds:readonly string[];
  readonly planRegistry:KeyRegistry; readonly trustedPlanSignerIds:readonly string[];
  readonly resolutionRegistry:KeyRegistry; readonly trustedResolutionSignerIds:readonly string[];
  readonly rehearsalRegistry:KeyRegistry; readonly trustedRehearsalSignerIds:readonly string[];
  readonly approvalVoteRegistry:KeyRegistry; readonly trustedApprovalVoterIds:readonly string[];
  readonly approvalCertificateRegistry:KeyRegistry; readonly trustedApprovalCertificateSignerIds:readonly string[];
  readonly canaryPlanRegistry:KeyRegistry; readonly trustedCanaryPlanSignerIds:readonly string[];
  readonly canaryReportRegistry:KeyRegistry; readonly trustedCanaryReporterIds:readonly string[];
  readonly promotionRegistry:KeyRegistry; readonly trustedPromotionSignerIds:readonly string[];
  readonly rollbackRegistry:KeyRegistry; readonly trustedRollbackSignerIds:readonly string[];
  readonly checkpointRegistry:KeyRegistry; readonly trustedCheckpointSignerIds:readonly string[];
  readonly recoveryRegistry:KeyRegistry; readonly trustedRecoverySignerIds:readonly string[];
  readonly retentionRegistry:KeyRegistry; readonly trustedRetentionSignerIds:readonly string[];
}

const hex=(v:string,e:string)=>{if(!/^[0-9a-f]{64}$/.test(v))throw new Error(e);};
const nonEmpty=(v:string,e:string)=>{if(v.trim()==='')throw new Error(e);};
const iso=(v:string,e:string)=>{const n=Date.parse(v);if(!Number.isFinite(n))throw new Error(e);return n;};
const digestWithout=<T extends Record<string,unknown>>(p:T,k:keyof T)=>{const m={...p};delete m[k];return sha256(m);};
const assertDigest=<T extends Record<string,unknown>>(p:T,k:keyof T,e:string)=>{if(p[k]!==digestWithout(p,k))throw new Error(e);};
const sortedUnique=(xs:readonly string[],e:string)=>{const s=[...xs].sort();if(new Set(s).size!==s.length)throw new Error(e);return s;};
function verifyEnvelope<T>(e:SignedEnvelope<T>,r:KeyRegistry,ids:readonly string[],at:Date,error:string){if(!ids.includes(e.issuerKeyId)||!r.verifyAt(e,at))throw new Error(error);}
function baseVerdictValid(v:DependencyUpdatePlannerVerdictV33_44){const {verdictDigest,...m}=v;if(verdictDigest!==sha256(m))throw new Error('transaction_base_verdict_digest_invalid');if(v.status!=='LOCAL_DEPENDENCY_UPDATE_PLANNER_PROVEN'||v.productionAuthority!=='NONE'||v.externalEffectsExecuted!==0||v.externalHumanParticipants!==0||v.updatePromoted!==false)throw new Error('transaction_base_verdict_boundary_invalid');}
function semver(v:string){const m=/^(\d+)\.(\d+)\.(\d+)$/.exec(v);if(!m)throw new Error('transaction_semver_invalid');return m.slice(1).map(Number) as [number,number,number];}
function isUpgrade(a:string,b:string){const x=semver(a),y=semver(b);for(let i=0;i<3;i++){if(y[i]!>x[i]!)return true;if(y[i]!<x[i]!)return false;}return false;}

export function createSignedTransactionPolicyV33_45(i:{signer:SigningIdentity;policyId:string;minPackages:number;maxPackages:number;canaryStages:readonly number[];holdbackPercent:number;minimumSamplesPerStage:number;maximumErrorRateBps:number;maximumRegressionCount:number;minimumRetainedGenerations:number;generatedAt:Date}){
  nonEmpty(i.policyId,'transaction_policy_id_required');
  if(!Number.isInteger(i.minPackages)||i.minPackages<2||!Number.isInteger(i.maxPackages)||i.maxPackages<i.minPackages||i.maxPackages>10)throw new Error('transaction_policy_package_limits_invalid');
  const stages=[...i.canaryStages];if(stages.length!==3||stages.some((v,index)=>!Number.isInteger(v)||v<1||v>100||(index>0&&v<=stages[index-1]!)))throw new Error('transaction_policy_canary_stages_invalid');
  if(!Number.isInteger(i.holdbackPercent)||i.holdbackPercent<1||i.holdbackPercent>=100||stages.at(-1)!+i.holdbackPercent>100)throw new Error('transaction_policy_holdback_invalid');
  if(!Number.isInteger(i.minimumSamplesPerStage)||i.minimumSamplesPerStage<1||!Number.isInteger(i.maximumErrorRateBps)||i.maximumErrorRateBps<0||i.maximumErrorRateBps>10_000||!Number.isInteger(i.maximumRegressionCount)||i.maximumRegressionCount<0||!Number.isInteger(i.minimumRetainedGenerations)||i.minimumRetainedGenerations<4)throw new Error('transaction_policy_thresholds_invalid');
  const m={version:'33.45' as const,policyId:i.policyId,sequence:1 as const,predecessorPolicyDigest:null, minPackages:i.minPackages,maxPackages:i.maxPackages,requireAtomicCommit:true as const,minimumIndependentApprovals:3 as const,requiredApprovalRoles:['OPERATIONS','RELEASE','SECURITY'] as const,canaryStages:stages,holdbackPercent:i.holdbackPercent,minimumSamplesPerStage:i.minimumSamplesPerStage,maximumErrorRateBps:i.maximumErrorRateBps,maximumRegressionCount:i.maximumRegressionCount,minimumRetainedGenerations:i.minimumRetainedGenerations,generatedAt:i.generatedAt.toISOString()};
  return signEnvelope({...m,policyDigest:sha256(m)},i.signer);
}
export function createPackageMutationV33_45(i:{packageName:string;currentVersion:string;targetVersion:string;artifactDigest:string;provenanceDigest:string;compatibilityGroup:string;directDependencies:readonly string[]}){
  nonEmpty(i.packageName,'transaction_package_name_required');nonEmpty(i.compatibilityGroup,'transaction_compatibility_group_required');hex(i.artifactDigest,'transaction_artifact_digest_invalid');hex(i.provenanceDigest,'transaction_provenance_digest_invalid');if(!isUpgrade(i.currentVersion,i.targetVersion))throw new Error('transaction_package_not_upgrade');
  const deps=sortedUnique(i.directDependencies,'transaction_package_duplicate_dependency');if(deps.includes(i.packageName))throw new Error('transaction_package_self_dependency');
  const m={packageName:i.packageName,currentVersion:i.currentVersion,targetVersion:i.targetVersion,artifactDigest:i.artifactDigest,provenanceDigest:i.provenanceDigest,compatibilityGroup:i.compatibilityGroup,directDependencies:deps,reversible:true as const,stateMigration:false as const};
  return {...m,mutationDigest:sha256(m)};
}
export function createSignedTransactionPlanV33_45(i:{signer:SigningIdentity;transactionId:string;policyDigest:string;baseManifestDigest:string;packageMutations:readonly PackageMutationV33_45[];plannedAt:Date}){
  nonEmpty(i.transactionId,'transaction_id_required');hex(i.policyDigest,'transaction_plan_policy_invalid');hex(i.baseManifestDigest,'transaction_plan_base_invalid');
  const mutations=[...i.packageMutations].sort((a,b)=>a.packageName.localeCompare(b.packageName));if(new Set(mutations.map(x=>x.packageName)).size!==mutations.length)throw new Error('transaction_plan_duplicate_package');for(const x of mutations){assertDigest(x as unknown as Record<string,unknown>,'mutationDigest','transaction_mutation_digest_invalid');}
  const transactionManifestDigest=sha256({baseManifestDigest:i.baseManifestDigest,mutations:mutations.map(x=>x.mutationDigest)});
  const m={version:'33.45' as const,transactionId:i.transactionId,policyDigest:i.policyDigest,baseManifestDigest:i.baseManifestDigest,packageMutations:mutations,packageCount:mutations.length,transactionManifestDigest,plannedAt:i.plannedAt.toISOString()};
  return signEnvelope({...m,planDigest:sha256(m)},i.signer);
}
export function createSignedConflictResolutionV33_45(i:{signer:SigningIdentity;transactionPlanDigest:string;dependencyGraphDigest:string;conflictCount:number;resolvedConflictCount:number;atomicCompatibilityGroups:readonly string[];resolutionRules:readonly string[];analyzedAt:Date}){
  hex(i.transactionPlanDigest,'transaction_resolution_plan_invalid');hex(i.dependencyGraphDigest,'transaction_resolution_graph_invalid');if(!Number.isInteger(i.conflictCount)||i.conflictCount<0||i.resolvedConflictCount!==i.conflictCount)throw new Error('transaction_resolution_unresolved_conflict');
  const groups=sortedUnique(i.atomicCompatibilityGroups,'transaction_resolution_duplicate_group');const rules=sortedUnique(i.resolutionRules,'transaction_resolution_duplicate_rule');if(groups.length<1||rules.length<1)throw new Error('transaction_resolution_contract_invalid');
  const m={version:'33.45' as const,transactionPlanDigest:i.transactionPlanDigest,dependencyGraphDigest:i.dependencyGraphDigest,conflictCount:i.conflictCount,resolvedConflictCount:i.resolvedConflictCount,unresolvedConflictCount:0 as const,atomicCompatibilityGroups:groups,resolutionRules:rules,analyzedAt:i.analyzedAt.toISOString()};
  return signEnvelope({...m,resolutionDigest:sha256(m)},i.signer);
}
export function createSignedTransactionRehearsalV33_45(i:{signer:SigningIdentity;transactionPlanDigest:string;resolutionDigest:string;testCount:number;rehearsalLogDigest:string;completedAt:Date}){
  hex(i.transactionPlanDigest,'transaction_rehearsal_plan_invalid');hex(i.resolutionDigest,'transaction_rehearsal_resolution_invalid');hex(i.rehearsalLogDigest,'transaction_rehearsal_log_invalid');if(!Number.isInteger(i.testCount)||i.testCount<1)throw new Error('transaction_rehearsal_test_count_invalid');
  const m={version:'33.45' as const,transactionPlanDigest:i.transactionPlanDigest,resolutionDigest:i.resolutionDigest,command:'npm ci --offline && npm run build && node --test' as const,cacheInitiallyEmpty:true as const,networkRequestsObserved:0 as const,installExitCode:0 as const,buildExitCode:0 as const,testCount:i.testCount,testFailures:0 as const,compatibilityFailures:0 as const,interruptedUpdateRecoveryTested:true as const,partialRollbackScenarioTested:true as const,fullRollbackScenarioTested:true as const,rehearsalLogDigest:i.rehearsalLogDigest,completedAt:i.completedAt.toISOString()};
  return signEnvelope({...m,rehearsalDigest:sha256(m)},i.signer);
}
export function createSignedTransactionApprovalVoteV33_45(i:{signer:SigningIdentity;transactionPlanDigest:string;rehearsalDigest:string;role:TransactionApprovalRoleV33_45;organization:string;votedAt:Date}){
  hex(i.transactionPlanDigest,'transaction_vote_plan_invalid');hex(i.rehearsalDigest,'transaction_vote_rehearsal_invalid');nonEmpty(i.organization,'transaction_vote_org_required');const m={version:'33.45' as const,transactionPlanDigest:i.transactionPlanDigest,rehearsalDigest:i.rehearsalDigest,role:i.role,organization:i.organization,decision:'APPROVE' as const,votedAt:i.votedAt.toISOString()};return signEnvelope({...m,voteDigest:sha256(m)},i.signer);
}
export function createSignedTransactionApprovalCertificateV33_45(i:{signer:SigningIdentity;policyDigest:string;transactionPlanDigest:string;rehearsalDigest:string;voteDigests:readonly string[];issuedAt:Date}){
  hex(i.policyDigest,'transaction_certificate_policy_invalid');hex(i.transactionPlanDigest,'transaction_certificate_plan_invalid');hex(i.rehearsalDigest,'transaction_certificate_rehearsal_invalid');const votes=sortedUnique(i.voteDigests,'transaction_certificate_duplicate_vote');if(votes.length!==3)throw new Error('transaction_certificate_vote_count_invalid');const m={version:'33.45' as const,policyDigest:i.policyDigest,transactionPlanDigest:i.transactionPlanDigest,rehearsalDigest:i.rehearsalDigest,voteDigests:votes,issuedAt:i.issuedAt.toISOString()};return signEnvelope({...m,certificateDigest:sha256(m)},i.signer);
}
export function createSignedStagedCanaryPlanV33_45(i:{signer:SigningIdentity;transactionPlanDigest:string;approvalCertificateDigest:string;stagePercents:readonly number[];holdbackPercent:number;minimumSamplesPerStage:number;maximumErrorRateBps:number;maximumRegressionCount:number;cohortDigest:string;startedAt:Date}){
  hex(i.transactionPlanDigest,'transaction_canary_plan_transaction_invalid');hex(i.approvalCertificateDigest,'transaction_canary_plan_approval_invalid');hex(i.cohortDigest,'transaction_canary_plan_cohort_invalid');const stages=[...i.stagePercents];if(stages.length!==3||stages.some((v,index)=>!Number.isInteger(v)||v<1||(index>0&&v<=stages[index-1]!))||stages.at(-1)!+i.holdbackPercent>100)throw new Error('transaction_canary_plan_stages_invalid');
  const m={version:'33.45' as const,transactionPlanDigest:i.transactionPlanDigest,approvalCertificateDigest:i.approvalCertificateDigest,stagePercents:stages,holdbackPercent:i.holdbackPercent,minimumSamplesPerStage:i.minimumSamplesPerStage,maximumErrorRateBps:i.maximumErrorRateBps,maximumRegressionCount:i.maximumRegressionCount,cohortDigest:i.cohortDigest,startedAt:i.startedAt.toISOString()};return signEnvelope({...m,planDigest:sha256(m)},i.signer);
}
export function createSignedStagedCanaryReportV33_45(i:{signer:SigningIdentity;planDigest:string;transactionPlanDigest:string;stage:CanaryStageV33_45;stagePercent:number;monitorOrganization:string;sampleCount:number;errorCount:number;regressionCount:number;observedAt:Date}){
  hex(i.planDigest,'transaction_canary_report_plan_invalid');hex(i.transactionPlanDigest,'transaction_canary_report_transaction_invalid');nonEmpty(i.monitorOrganization,'transaction_canary_report_org_required');if(!Number.isInteger(i.stagePercent)||i.stagePercent<1||!Number.isInteger(i.sampleCount)||i.sampleCount<1||!Number.isInteger(i.errorCount)||i.errorCount<0||i.errorCount>i.sampleCount||!Number.isInteger(i.regressionCount)||i.regressionCount<0)throw new Error('transaction_canary_report_metrics_invalid');
  const m={version:'33.45' as const,planDigest:i.planDigest,transactionPlanDigest:i.transactionPlanDigest,stage:i.stage,stagePercent:i.stagePercent,monitorOrganization:i.monitorOrganization,sampleCount:i.sampleCount,errorCount:i.errorCount,regressionCount:i.regressionCount,observedAt:i.observedAt.toISOString()};return signEnvelope({...m,reportDigest:sha256(m)},i.signer);
}
export function createSignedPromotionCertificateV33_45(i:{signer:SigningIdentity;policyDigest:string;transactionPlanDigest:string;planDigest:string;reportDigests:readonly string[];totalSamples:number;totalErrors:number;totalRegressions:number;issuedAt:Date}){
  for(const [v,e] of [[i.policyDigest,'transaction_promotion_policy_invalid'],[i.transactionPlanDigest,'transaction_promotion_transaction_invalid'],[i.planDigest,'transaction_promotion_plan_invalid']] as const)hex(v,e);const reports=sortedUnique(i.reportDigests,'transaction_promotion_duplicate_report');if(reports.length!==9||i.totalSamples<1||i.totalErrors<0||i.totalErrors>i.totalSamples||i.totalRegressions<0)throw new Error('transaction_promotion_aggregate_invalid');const errorRateBps=Math.floor(i.totalErrors*10_000/i.totalSamples);const m={version:'33.45' as const,policyDigest:i.policyDigest,transactionPlanDigest:i.transactionPlanDigest,planDigest:i.planDigest,reportDigests:reports,totalSamples:i.totalSamples,totalErrors:i.totalErrors,totalRegressions:i.totalRegressions,errorRateBps,decision:'PROMOTION_ELIGIBLE_LOCAL_REHEARSAL_ONLY' as const,issuedAt:i.issuedAt.toISOString()};return signEnvelope({...m,promotionDigest:sha256(m)},i.signer);
}
export function createSignedRollbackDecisionV33_45(i:{signer:SigningIdentity;transactionPlanDigest:string;scenarioId:string;failedPackages:readonly string[];coupledCompatibilityGroups:readonly string[];decision:RollbackModeV33_45;decidedAt:Date}){
  hex(i.transactionPlanDigest,'transaction_rollback_plan_invalid');nonEmpty(i.scenarioId,'transaction_rollback_scenario_required');const failed=sortedUnique(i.failedPackages,'transaction_rollback_duplicate_package');const groups=sortedUnique(i.coupledCompatibilityGroups,'transaction_rollback_duplicate_group');if(failed.length<1)throw new Error('transaction_rollback_package_required');const expected:RollbackModeV33_45=groups.length===0&&failed.length===1?'PARTIAL':'FULL';if(i.decision!==expected)throw new Error('transaction_rollback_mode_invalid');const reason=i.decision==='PARTIAL'?'ISOLATED_REVERSIBLE_FAILURE' as const:'ATOMIC_GROUP_OR_UNKNOWN_STATE' as const;const m={version:'33.45' as const,transactionPlanDigest:i.transactionPlanDigest,scenarioId:i.scenarioId,failedPackages:failed,coupledCompatibilityGroups:groups,decision:i.decision,reason,decidedAt:i.decidedAt.toISOString()};return signEnvelope({...m,decisionDigest:sha256(m)},i.signer);
}
export function createSignedInterruptedCheckpointV33_45(i:{signer:SigningIdentity;transactionPlanDigest:string;sequence:number;appliedPackages:readonly string[];pendingPackages:readonly string[];durableJournalDigest:string;recordedAt:Date}){
  hex(i.transactionPlanDigest,'transaction_checkpoint_plan_invalid');hex(i.durableJournalDigest,'transaction_checkpoint_journal_invalid');if(!Number.isInteger(i.sequence)||i.sequence<1)throw new Error('transaction_checkpoint_sequence_invalid');const applied=sortedUnique(i.appliedPackages,'transaction_checkpoint_duplicate_applied');const pending=sortedUnique(i.pendingPackages,'transaction_checkpoint_duplicate_pending');if(applied.length<1||pending.length<1||applied.some(x=>pending.includes(x)))throw new Error('transaction_checkpoint_partition_invalid');const m={version:'33.45' as const,transactionPlanDigest:i.transactionPlanDigest,sequence:i.sequence,stage:'APPLYING' as const,appliedPackages:applied,pendingPackages:pending,durableJournalDigest:i.durableJournalDigest,recordedAt:i.recordedAt.toISOString()};return signEnvelope({...m,checkpointDigest:sha256(m)},i.signer);
}
export function createSignedInterruptedRecoveryV33_45(i:{signer:SigningIdentity;transactionPlanDigest:string;checkpointDigest:string;restoredManifestDigest:string;resumedSequence:number;recoveredAt:Date}){
  hex(i.transactionPlanDigest,'transaction_recovery_plan_invalid');hex(i.checkpointDigest,'transaction_recovery_checkpoint_invalid');hex(i.restoredManifestDigest,'transaction_recovery_manifest_invalid');if(!Number.isInteger(i.resumedSequence)||i.resumedSequence<2)throw new Error('transaction_recovery_sequence_invalid');const m={version:'33.45' as const,transactionPlanDigest:i.transactionPlanDigest,checkpointDigest:i.checkpointDigest,recoveryMode:'FULL_ROLLBACK_TO_BASE' as const,restoredManifestDigest:i.restoredManifestDigest,resumedSequence:i.resumedSequence,forkDetected:false as const,partialStateRemaining:false as const,recoveredAt:i.recoveredAt.toISOString()};return signEnvelope({...m,recoveryDigest:sha256(m)},i.signer);
}
export function createSignedMultiGenerationRetentionV33_45(i:{signer:SigningIdentity;activeManifestDigest:string;generations:readonly TransactionGenerationV33_45[];recordedAt:Date}){
  hex(i.activeManifestDigest,'transaction_retention_active_invalid');const generations=[...i.generations].sort((a,b)=>a.sequence-b.sequence);if(generations.some((g,index)=>g.sequence!==index+1))throw new Error('transaction_retention_sequence_invalid');if(new Set(generations.map(g=>g.manifestDigest)).size!==generations.length)throw new Error('transaction_retention_duplicate_manifest');for(const g of generations){hex(g.manifestDigest,'transaction_retention_manifest_invalid');hex(g.artifactDigest,'transaction_retention_artifact_invalid');}if(generations.filter(g=>g.status==='ACTIVE').length!==1||generations.find(g=>g.status==='ACTIVE')?.manifestDigest!==i.activeManifestDigest)throw new Error('transaction_retention_active_mismatch');const m={version:'33.45' as const,sequence:1 as const,predecessorLedgerDigest:null,activeManifestDigest:i.activeManifestDigest,generations,recordedAt:i.recordedAt.toISOString()};return signEnvelope({...m,ledgerDigest:sha256(m)},i.signer);
}

export function verifyMultiPackageUpdateTransactionV33_45(i:{baseVerdict:DependencyUpdatePlannerVerdictV33_44;policy:SignedEnvelope<TransactionPolicyPayloadV33_45>;transactionPlan:SignedEnvelope<TransactionPlanPayloadV33_45>;resolution:SignedEnvelope<ConflictResolutionPayloadV33_45>;rehearsal:SignedEnvelope<TransactionRehearsalPayloadV33_45>;approvalVotes:readonly SignedEnvelope<TransactionApprovalVotePayloadV33_45>[];approvalCertificate:SignedEnvelope<TransactionApprovalCertificatePayloadV33_45>;canaryPlan:SignedEnvelope<StagedCanaryPlanPayloadV33_45>;canaryReports:readonly SignedEnvelope<StagedCanaryReportPayloadV33_45>[];promotionCertificate:SignedEnvelope<PromotionCertificatePayloadV33_45>;rollbackDecisions:readonly SignedEnvelope<RollbackDecisionPayloadV33_45>[];interruptedCheckpoint:SignedEnvelope<InterruptedTransactionCheckpointPayloadV33_45>;interruptedRecovery:SignedEnvelope<InterruptedTransactionRecoveryPayloadV33_45>;retentionLedger:SignedEnvelope<MultiGenerationRetentionPayloadV33_45>;trust:MultiPackageUpdateTransactionTrustV33_45;verifiedAt:Date}):MultiPackageUpdateTransactionVerdictV33_45 {
  baseVerdictValid(i.baseVerdict);const at=i.verifiedAt;
  verifyEnvelope(i.policy,i.trust.policyRegistry,i.trust.trustedPolicySignerIds,at,'transaction_policy_signature_invalid');assertDigest(i.policy.payload as unknown as Record<string,unknown>,'policyDigest','transaction_policy_digest_invalid');
  verifyEnvelope(i.transactionPlan,i.trust.planRegistry,i.trust.trustedPlanSignerIds,at,'transaction_plan_signature_invalid');assertDigest(i.transactionPlan.payload as unknown as Record<string,unknown>,'planDigest','transaction_plan_digest_invalid');
  if(i.transactionPlan.payload.policyDigest!==i.policy.payload.policyDigest||i.transactionPlan.payload.baseManifestDigest!==i.baseVerdict.rollbackDigest)throw new Error('transaction_plan_base_contract_invalid');if(i.transactionPlan.payload.packageCount<i.policy.payload.minPackages||i.transactionPlan.payload.packageCount>i.policy.payload.maxPackages)throw new Error('transaction_plan_package_count_invalid');
  const names=i.transactionPlan.payload.packageMutations.map(x=>x.packageName);if(new Set(names).size!==names.length)throw new Error('transaction_plan_duplicate_package');for(const m of i.transactionPlan.payload.packageMutations)assertDigest(m as unknown as Record<string,unknown>,'mutationDigest','transaction_mutation_digest_invalid');
  const manifest=sha256({baseManifestDigest:i.transactionPlan.payload.baseManifestDigest,mutations:i.transactionPlan.payload.packageMutations.map(x=>x.mutationDigest)});if(manifest!==i.transactionPlan.payload.transactionManifestDigest)throw new Error('transaction_manifest_digest_invalid');
  verifyEnvelope(i.resolution,i.trust.resolutionRegistry,i.trust.trustedResolutionSignerIds,at,'transaction_resolution_signature_invalid');assertDigest(i.resolution.payload as unknown as Record<string,unknown>,'resolutionDigest','transaction_resolution_digest_invalid');if(i.resolution.payload.transactionPlanDigest!==i.transactionPlan.payload.planDigest||i.resolution.payload.unresolvedConflictCount!==0||i.resolution.payload.conflictCount!==i.resolution.payload.resolvedConflictCount)throw new Error('transaction_resolution_contract_invalid');
  const groups=[...new Set(i.transactionPlan.payload.packageMutations.map(x=>x.compatibilityGroup))].sort();if(JSON.stringify(groups)!==JSON.stringify([...i.resolution.payload.atomicCompatibilityGroups].sort()))throw new Error('transaction_resolution_group_inventory_invalid');
  verifyEnvelope(i.rehearsal,i.trust.rehearsalRegistry,i.trust.trustedRehearsalSignerIds,at,'transaction_rehearsal_signature_invalid');assertDigest(i.rehearsal.payload as unknown as Record<string,unknown>,'rehearsalDigest','transaction_rehearsal_digest_invalid');if(i.rehearsal.payload.transactionPlanDigest!==i.transactionPlan.payload.planDigest||i.rehearsal.payload.resolutionDigest!==i.resolution.payload.resolutionDigest||i.rehearsal.payload.testCount<33)throw new Error('transaction_rehearsal_contract_invalid');
  if(i.approvalVotes.length!==i.policy.payload.minimumIndependentApprovals)throw new Error('transaction_approval_quorum_invalid');const voteRoles:string[]=[];const voteOrgs:string[]=[];const voteDigests:string[]=[];for(const v of i.approvalVotes){verifyEnvelope(v,i.trust.approvalVoteRegistry,i.trust.trustedApprovalVoterIds,at,'transaction_vote_signature_invalid');assertDigest(v.payload as unknown as Record<string,unknown>,'voteDigest','transaction_vote_digest_invalid');if(v.payload.transactionPlanDigest!==i.transactionPlan.payload.planDigest||v.payload.rehearsalDigest!==i.rehearsal.payload.rehearsalDigest)throw new Error('transaction_vote_contract_invalid');voteRoles.push(v.payload.role);voteOrgs.push(v.payload.organization);voteDigests.push(v.payload.voteDigest);}if(new Set(voteRoles).size!==3||new Set(voteOrgs).size!==3||!i.policy.payload.requiredApprovalRoles.every(x=>voteRoles.includes(x)))throw new Error('transaction_approval_not_independent');
  verifyEnvelope(i.approvalCertificate,i.trust.approvalCertificateRegistry,i.trust.trustedApprovalCertificateSignerIds,at,'transaction_certificate_signature_invalid');assertDigest(i.approvalCertificate.payload as unknown as Record<string,unknown>,'certificateDigest','transaction_certificate_digest_invalid');if(i.approvalCertificate.payload.policyDigest!==i.policy.payload.policyDigest||i.approvalCertificate.payload.transactionPlanDigest!==i.transactionPlan.payload.planDigest||i.approvalCertificate.payload.rehearsalDigest!==i.rehearsal.payload.rehearsalDigest||JSON.stringify([...i.approvalCertificate.payload.voteDigests].sort())!==JSON.stringify(voteDigests.sort()))throw new Error('transaction_certificate_contract_invalid');
  verifyEnvelope(i.canaryPlan,i.trust.canaryPlanRegistry,i.trust.trustedCanaryPlanSignerIds,at,'transaction_canary_plan_signature_invalid');assertDigest(i.canaryPlan.payload as unknown as Record<string,unknown>,'planDigest','transaction_canary_plan_digest_invalid');if(i.canaryPlan.payload.transactionPlanDigest!==i.transactionPlan.payload.planDigest||i.canaryPlan.payload.approvalCertificateDigest!==i.approvalCertificate.payload.certificateDigest||JSON.stringify(i.canaryPlan.payload.stagePercents)!==JSON.stringify(i.policy.payload.canaryStages)||i.canaryPlan.payload.holdbackPercent!==i.policy.payload.holdbackPercent)throw new Error('transaction_canary_plan_contract_invalid');
  if(i.canaryReports.length!==9)throw new Error('transaction_canary_report_count_invalid');const expectedStages:['STAGE_1','STAGE_2','STAGE_3']=['STAGE_1','STAGE_2','STAGE_3'];const reportDigests:string[]=[];let totalSamples=0,totalErrors=0,totalRegressions=0;const monitorOrgs=new Set<string>();for(const stage of expectedStages){const rows=i.canaryReports.filter(x=>x.payload.stage===stage);if(rows.length!==3)throw new Error('transaction_canary_stage_quorum_invalid');const stageOrgs=new Set<string>();for(const r of rows){verifyEnvelope(r,i.trust.canaryReportRegistry,i.trust.trustedCanaryReporterIds,at,'transaction_canary_report_signature_invalid');assertDigest(r.payload as unknown as Record<string,unknown>,'reportDigest','transaction_canary_report_digest_invalid');if(r.payload.planDigest!==i.canaryPlan.payload.planDigest||r.payload.transactionPlanDigest!==i.transactionPlan.payload.planDigest||r.payload.stagePercent!==i.canaryPlan.payload.stagePercents[expectedStages.indexOf(stage)]||r.payload.sampleCount<i.canaryPlan.payload.minimumSamplesPerStage)throw new Error('transaction_canary_report_contract_invalid');stageOrgs.add(r.payload.monitorOrganization);monitorOrgs.add(r.payload.monitorOrganization);reportDigests.push(r.payload.reportDigest);totalSamples+=r.payload.sampleCount;totalErrors+=r.payload.errorCount;totalRegressions+=r.payload.regressionCount;}if(stageOrgs.size!==3)throw new Error('transaction_canary_monitor_not_independent');}
  if(monitorOrgs.size!==3)throw new Error('transaction_canary_monitor_inventory_invalid');
  verifyEnvelope(i.promotionCertificate,i.trust.promotionRegistry,i.trust.trustedPromotionSignerIds,at,'transaction_promotion_signature_invalid');assertDigest(i.promotionCertificate.payload as unknown as Record<string,unknown>,'promotionDigest','transaction_promotion_digest_invalid');if(i.promotionCertificate.payload.policyDigest!==i.policy.payload.policyDigest||i.promotionCertificate.payload.transactionPlanDigest!==i.transactionPlan.payload.planDigest||i.promotionCertificate.payload.planDigest!==i.canaryPlan.payload.planDigest||JSON.stringify([...i.promotionCertificate.payload.reportDigests].sort())!==JSON.stringify(reportDigests.sort())||i.promotionCertificate.payload.totalSamples!==totalSamples||i.promotionCertificate.payload.totalErrors!==totalErrors||i.promotionCertificate.payload.totalRegressions!==totalRegressions||i.promotionCertificate.payload.errorRateBps!==Math.floor(totalErrors*10_000/totalSamples)||i.promotionCertificate.payload.errorRateBps>i.policy.payload.maximumErrorRateBps||totalRegressions>i.policy.payload.maximumRegressionCount)throw new Error('transaction_promotion_contract_invalid');
  if(i.rollbackDecisions.length!==2)throw new Error('transaction_rollback_decision_count_invalid');let partial:SignedEnvelope<RollbackDecisionPayloadV33_45>|undefined;let full:SignedEnvelope<RollbackDecisionPayloadV33_45>|undefined;for(const d of i.rollbackDecisions){verifyEnvelope(d,i.trust.rollbackRegistry,i.trust.trustedRollbackSignerIds,at,'transaction_rollback_signature_invalid');assertDigest(d.payload as unknown as Record<string,unknown>,'decisionDigest','transaction_rollback_digest_invalid');if(d.payload.transactionPlanDigest!==i.transactionPlan.payload.planDigest)throw new Error('transaction_rollback_contract_invalid');if(d.payload.decision==='PARTIAL')partial=d;else full=d;}if(!partial||!full||partial.payload.failedPackages.length!==1||partial.payload.coupledCompatibilityGroups.length!==0||full.payload.coupledCompatibilityGroups.length<1)throw new Error('transaction_rollback_classification_invalid');
  verifyEnvelope(i.interruptedCheckpoint,i.trust.checkpointRegistry,i.trust.trustedCheckpointSignerIds,at,'transaction_checkpoint_signature_invalid');assertDigest(i.interruptedCheckpoint.payload as unknown as Record<string,unknown>,'checkpointDigest','transaction_checkpoint_digest_invalid');if(i.interruptedCheckpoint.payload.transactionPlanDigest!==i.transactionPlan.payload.planDigest||i.interruptedCheckpoint.payload.appliedPackages.length+i.interruptedCheckpoint.payload.pendingPackages.length!==i.transactionPlan.payload.packageCount)throw new Error('transaction_checkpoint_contract_invalid');
  verifyEnvelope(i.interruptedRecovery,i.trust.recoveryRegistry,i.trust.trustedRecoverySignerIds,at,'transaction_recovery_signature_invalid');assertDigest(i.interruptedRecovery.payload as unknown as Record<string,unknown>,'recoveryDigest','transaction_recovery_digest_invalid');if(i.interruptedRecovery.payload.transactionPlanDigest!==i.transactionPlan.payload.planDigest||i.interruptedRecovery.payload.checkpointDigest!==i.interruptedCheckpoint.payload.checkpointDigest||i.interruptedRecovery.payload.restoredManifestDigest!==i.transactionPlan.payload.baseManifestDigest||i.interruptedRecovery.payload.resumedSequence!==i.interruptedCheckpoint.payload.sequence+1||i.interruptedRecovery.payload.forkDetected!==false||i.interruptedRecovery.payload.partialStateRemaining!==false)throw new Error('transaction_recovery_contract_invalid');
  verifyEnvelope(i.retentionLedger,i.trust.retentionRegistry,i.trust.trustedRetentionSignerIds,at,'transaction_retention_signature_invalid');assertDigest(i.retentionLedger.payload as unknown as Record<string,unknown>,'ledgerDigest','transaction_retention_digest_invalid');if(i.retentionLedger.payload.generations.length<i.policy.payload.minimumRetainedGenerations||i.retentionLedger.payload.activeManifestDigest!==i.transactionPlan.payload.baseManifestDigest)throw new Error('transaction_retention_contract_invalid');const statuses=new Set(i.retentionLedger.payload.generations.map(x=>x.status));if(!['ACTIVE','ROLLBACK_READY','CANDIDATE','RECOVERY_BASE'].every(x=>statuses.has(x as TransactionGenerationV33_45['status'])))throw new Error('transaction_retention_status_inventory_invalid');
  const m={version:'33.45' as const,status:'LOCAL_MULTI_PACKAGE_UPDATE_TRANSACTION_PROVEN' as const,basePlannerVerdictDigest:i.baseVerdict.verdictDigest,policyDigest:i.policy.payload.policyDigest,transactionPlanDigest:i.transactionPlan.payload.planDigest,resolutionDigest:i.resolution.payload.resolutionDigest,rehearsalDigest:i.rehearsal.payload.rehearsalDigest,approvalCertificateDigest:i.approvalCertificate.payload.certificateDigest,canaryPlanDigest:i.canaryPlan.payload.planDigest,promotionDigest:i.promotionCertificate.payload.promotionDigest,partialRollbackDecisionDigest:partial.payload.decisionDigest,fullRollbackDecisionDigest:full.payload.decisionDigest,interruptionRecoveryDigest:i.interruptedRecovery.payload.recoveryDigest,retentionLedgerDigest:i.retentionLedger.payload.ledgerDigest,packageCount:i.transactionPlan.payload.packageCount,approvalCount:i.approvalVotes.length,canaryStageCount:3,canaryMonitorCount:monitorOrgs.size,retainedGenerationCount:i.retentionLedger.payload.generations.length,atomicTransactionProven:true as const,conflictResolutionProven:true as const,stagedCanaryProven:true as const,promotionSuccessPathProven:true as const,rollbackClassificationProven:true as const,interruptionRecoveryProven:true as const,updatePromoted:false as const,externalPackageArtifactsObserved:false as const,externalCanaryTrafficObserved:false as const,externalHumanParticipants:0 as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const,verifiedAt:i.verifiedAt.toISOString()};
  return {...m,verdictDigest:sha256(m)};
}
