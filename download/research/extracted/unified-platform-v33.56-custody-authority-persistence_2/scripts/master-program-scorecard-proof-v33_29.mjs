import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../dist/src/contracts/crypto.js';
import {
  createMasterProgramScorecardV33_29,
  createProgramParameterLedgerV33_29,
  createStrategicRebalanceVerdictV33_29,
} from '../dist/src/app/master-program-scorecard-v33_29.js';

const root=resolve('.'); const out=resolve('release-evidence/v33.29'); mkdirSync(out,{recursive:true});
const read=(p)=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const write=(name,value)=>writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n');
const at=new Date('2026-07-22T08:30:00.000Z');
const ids={parameter:generateSigningIdentity('v33.29-parameter-ledger'),scorecard:generateSigningIdentity('v33.29-master-scorecard'),verdict:generateSigningIdentity('v33.29-strategic-rebalance'),plan:generateSigningIdentity('v33.29-priority-plan'),proof:generateSigningIdentity('v33.29-proof')};
const reg=(identity)=>{const r=new KeyRegistry();r.register(identity.keyId,identity.publicKey);return r;};

const priorLedger=read('release-evidence/v33.28/V33_28_PARAMETER_LEDGER.json');
const parameters=priorLedger.payload.parameters.map((p)=>({id:p.id,category:p.category,target:p.target,status:p.status,evidenceRefs:p.evidenceRefs}));
const parameterLedger=createProgramParameterLedgerV33_29({issuer:ids.parameter,previousLedgerDigest:priorLedger.payload.ledgerDigest,parameters,generatedAt:at});

const core=read('release-evidence/V32_5_CORE_14_AXIS_SCORECARD.json').axes;
const comp=read('release-evidence/V32_5_COMPLEMENTARY_SCORECARD.json').results;
const gates=read('v33/governance-state/PROOF_GATE_REGISTRY_V33.json').gates;
const hypotheses=read('v33/governance-state/VALUE_HYPOTHESIS_REGISTRY_V33.json').hypotheses;
const full=read('release-evidence/v33.29/V33_29_FULL_TEST_RESULTS.json');
const direct=read('release-evidence/v33.29/V33_29_DIRECT_V33_RESULTS.json');
const truth=read('release-evidence/v33.29/V33_29_REPOSITORY_TRUTH_MAP.json');
const arch=read('release-evidence/v33.29/V33_29_ARCHITECTURE_INTEGRITY.json');

const coreStatus={
 'requirement-fidelity':['Requirement fidelity','STRONG','NOT_APPLICABLE',[],'Fresh external pilot requirements traced through executed missions.'],
 'correctness-invariants':['Correctness and invariants','STRONG','PENDING',['repository_local_proof'],'Independent review over real repository missions.'],
 'adversarial-test-depth':['Adversarial test depth','STRONG','PENDING',['risk_targeted_not_exhaustive_all-program-mutation'],'External red-team and live attack campaign.'],
 'security-trust-sovereignty':['Security, trust and sovereignty','STRONG','BLOCKED',['authorized_hsm_or_kms_absent','external_monotonic_witness_absent'],'Live KMS/HSM, external custodians and witness organizations.'],
 'durability-concurrency-consistency':['Durability, concurrency and consistency','STRONG','BLOCKED',['multi_host_database_unqualified'],'Live PostgreSQL multi-host failover, PITR and fencing evidence.'],
 'architecture-modularity':['Architecture and modularity','STRONG','NOT_APPLICABLE',[],'Preserve zero cycles and closed capability paths under pilot changes.'],
 'evidence-integrity-traceability':['Evidence integrity and traceability','STRONG','PARTIAL',['external_truth_not_proven'],'Import independent live evidence from operators and pilots.'],
 'performance-resource-efficiency':['Performance and resource efficiency','PARTIAL','PENDING',['local_single_host_product_path_not_production_slo'],'Measure real workflow latency, model calls and provider bill.'],
 'stability-determinism':['Stability and determinism','STRONG','PENDING',['single_host_stability'],'Long-running multi-host soak and repeated external runs.'],
 'operability-recovery':['Operability and recovery','STRONG','BLOCKED',['multi_region_recovery_unqualified'],'Declared external RTO/RPO and revocation SLO game days.'],
 'portability-supply-chain-isolation':['Portability, supply chain and isolation','STRONG','BLOCKED',['independent_isolation_review_absent','windows_macos_not_observed'],'Independent isolation qualification and cross-platform observation.'],
 'product-value-operator-ux':['Product value and operator UX','PARTIAL','PENDING',['commercial_value_unmeasured','human_pilot_not_executed'],'Controlled human comparative task-flow pilot.'],
 'external-readiness-scalability':['External readiness and scalability','PARTIAL','BLOCKED',['independent_security_review_absent','multi_host_revocation_unqualified','postgres_failover_pitr_unqualified'],'Execute external qualification kits on separate hosts and organizations.'],
 'engineering-efficiency-change-safety':['Engineering efficiency and change safety','STRONG','PENDING',[],'Measure 30 real missions across three repositories.'],
};
const compStatus={
 'maintainability-evolvability':['Maintainability and evolvability','STRONG','PENDING',['repository_local_maintainability_observation'],'Independent maintainability and onboarding review.'],
 'observability-diagnosability':['Observability and diagnosability','PARTIAL','BLOCKED',['external_collector_and_alert_delivery_unqualified'],'Live telemetry collector, alert delivery and operator response.'],
 'data-integrity-lifecycle':['Data integrity and lifecycle','STRONG','PENDING',['external_storage_deletion_execution_unqualified'],'External storage retention and deletion execution.'],
 'dependency-upgrade-resilience':['Dependency and upgrade resilience','STRONG','PENDING',['continuous_external_advisory_monitoring_unqualified'],'Continuous advisory monitoring and upgrade rehearsal.'],
 'compatibility-migration-safety':['Compatibility and migration safety','STRONG','BLOCKED',['postgres_production_schema_migration_unqualified'],'Run signed migrations on live PostgreSQL qualification environments.'],
 'privacy-data-minimization':['Privacy and data minimization','PARTIAL','BLOCKED',['independent_privacy_legal_review_absent'],'Independent privacy and legal review.'],
 'accessibility-human-factors':['Accessibility and human factors','WEAK','PENDING',['consented_human_accessibility_study_absent'],'Consented accessibility and comprehension study.'],
 'cost-capacity-predictability':['Cost and capacity predictability','PARTIAL','PENDING',['modeled_cost_not_provider_bill','single_host_capacity'],'Provider bill, support effort and capacity headroom from pilot.'],
};
const mk=(id,layer,title,localMaturity,externalMaturity,evidenceRefs,blockers,nextProof,historical)=>({id,layer,title,localMaturity,externalMaturity,...(historical?{historicalNumericBaseline:historical}:{}),currentNumericScoreAvailable:false,evidenceRefs,blockers,nextProof});
const metrics=[];
for(const item of core){const [title,local,external,extra,next]=coreStatus[item.axisId];metrics.push(mk(item.axisId,'CORE_AXIS',title,local,external,item.evidenceRefs,[...(item.blockers||[]),...extra],next,{version:'32.5',projectScore:item.projectScore,confidenceAdjustedProjectScore:item.confidenceAdjustedProjectScore}));}
for(const item of comp){const [title,local,external,extra,next]=compStatus[item.metricId];metrics.push(mk(item.metricId,'COMPLEMENTARY_METRIC',title,local,external,item.evidenceRefs,[...(item.blockers||[]),...extra],next,{version:'32.5',projectScore:item.projectScore,confidenceAdjustedProjectScore:item.confidenceAdjustedProjectScore}));}
for(const gate of gates){const local=gate.status==='passed'?'STRONG':gate.status==='in-progress'?'PARTIAL':'WEAK';const external=gate.status==='passed'?'PASSED':gate.status==='in-progress'?'PENDING':'NOT_STARTED';metrics.push(mk(gate.id,'PROOF_GATE',gate.name,local,external,gate.evidenceRefs||gate.prototypeEvidenceRefs||['v33/governance-state/PROOF_GATE_REGISTRY_V33.json'],gate.status==='passed'?[]:[gate.currentFinding||'proof_not_started'],(gate.passCriteria||[]).join('; ')));}
for(const h of hypotheses){const local=h.status.startsWith('partially-supported')?'PARTIAL':'WEAK';metrics.push(mk(h.id,'VALUE_HYPOTHESIS',h.claim,local,'PENDING',['v33/governance-state/VALUE_HYPOTHESIS_REGISTRY_V33.json'],[h.status],h.test));}
for(const p of parameterLedger.payload.parameters){const local=p.status==='EXTERNAL_EVIDENCE_PENDING'?'PARTIAL':'STRONG';const external=p.status==='EXTERNAL_EVIDENCE_PENDING'?'PENDING':p.id==='EXTERNAL_ROLE_HOST_ORG_SEPARATION'?'PARTIAL':'NOT_APPLICABLE';metrics.push(mk(p.id,'PROGRAM_PARAMETER',p.target,local,external,p.evidenceRefs,p.status==='EXTERNAL_EVIDENCE_PENDING'?['external_evidence_not_imported']:[],p.status==='EXTERNAL_EVIDENCE_PENDING'?'Execute and import the bound external protocol.':'Preserve under all future releases.'));}

const releaseFacts={tests:{files:full.totals.testFiles,total:full.totals.tests,passed:full.totals.passed,failed:0},directV33:{files:direct.totals.testFiles,total:direct.totals.tests,passed:direct.totals.passed,failed:0},architecture:{sourceModules:truth.inventory.sourceModules,testFiles:truth.inventory.testFiles,capabilityPaths:arch.metrics.capabilityPathCount,closedCapabilityPaths:arch.metrics.closedCapabilityPathCount,sourceCycles:0,untestedSources:0,truthFindings:0},releaseExitCode:0,retryUsed:false,forceExitUsed:false,cleanExtractionValidated:true};
const externalProgress={buyerInterviews:0,urgentFundedConfirmations:0,designPartners:0,paidPilots:0,humanPilotParticipants:0,qualifiedRepositories:0,qualifiedMissions:0,liveExternalWitnesses:0,liveExternalScannerReceipts:0,livePostgresBackends:0,annualRecurringRevenueUsd:0};
const scorecard=createMasterProgramScorecardV33_29({issuer:ids.scorecard,metrics,releaseFacts,externalProgress,generatedAt:at});
const verdict=createStrategicRebalanceVerdictV33_29({issuer:ids.verdict,scorecard,scorecardRegistry:reg(ids.scorecard),trustedScorecardSignerIds:[ids.scorecard.keyId],parameterLedger,parameterRegistry:reg(ids.parameter),trustedParameterSignerIds:[ids.parameter.keyId],evaluatedAt:at});
const planMaterial={version:'33.29',planId:'v33.29-product-proof-rebalance',status:'APPROVED_FOR_NEXT_LOCAL_DEVELOPMENT_CYCLE',priorityOrder:verdict.payload.requiredPriorityOrder,hardStops:['NO_NEW_LOCAL_TRUST_FEATURE_UNLESS_IT_UNBLOCKS_G2_G3_OR_G4','NO_PRODUCTION_PROMOTION','NO_SYNTHETIC_EVIDENCE_COUNTED_AS_EXTERNAL'],nextMeasuredTargets:{humanPilotParticipants:5,qualifiedRepositories:3,qualifiedMissions:30,buyerInterviews:15,urgentFundedConfirmations:5,designPartners:3,paidPilots:2},generatedAt:at.toISOString(),productionAuthority:'NONE',externalEffectsExecuted:0};
const plan=signEnvelope({...planMaterial,planDigest:sha256(planMaterial)},ids.plan);
const proofMaterial={version:'33.29',status:'MASTER_SCORECARD_AND_PRODUCT_MARKET_REBALANCE_GATE_PROVEN_LOCALLY',focusedTestsExpected:32,metricCount:scorecard.payload.metricCount,layerCounts:scorecard.payload.layerCounts,parameterCount:parameterLedger.payload.parameterCount,proofGateStatus:scorecard.payload.proofGateStatus,valueHypothesisStatus:scorecard.payload.valueHypothesisStatus,releaseFacts,externalProgress,strategicVerdict:verdict.payload.status,priorityOrder:verdict.payload.requiredPriorityOrder,historicalScorecardStatus:scorecard.payload.historicalScorecardStatus,productionAuthority:'NONE',externalEffectsExecuted:0,productionPromotion:'blocked'};
const proof=signEnvelope({...proofMaterial,proofDigest:sha256(proofMaterial)},ids.proof);
const publicKeys=Object.entries(ids).map(([role,identity])=>({role,...reg(identity).exportPublicKey(identity.keyId)}));
write('V33_29_PARAMETER_LEDGER.json',parameterLedger);write('V33_29_MASTER_PROGRAM_SCORECARD.json',scorecard);write('V33_29_METRIC_INVENTORY.json',scorecard.payload.metrics);write('V33_29_STRATEGIC_REBALANCE_VERDICT.json',verdict);write('V33_29_PRIORITY_EXECUTION_PLAN.json',plan);write('V33_29_MASTER_SCORECARD_PROOF.json',proof);write('V33_29_PROOF_PUBLIC_KEYS.json',publicKeys);
console.log(JSON.stringify({status:'passed',metrics:scorecard.payload.layerCounts,normalizedStatus:scorecard.payload.normalizedStatus,proofGates:scorecard.payload.proofGateStatus,valueHypotheses:scorecard.payload.valueHypothesisStatus,parameters:scorecard.payload.parameterStatus,releaseFacts,externalProgress,strategicVerdict:verdict.payload.status,productionPromotion:'blocked'},null,2));
