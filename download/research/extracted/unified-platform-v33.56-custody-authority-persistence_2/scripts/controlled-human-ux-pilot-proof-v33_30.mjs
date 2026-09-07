import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateSigningIdentity, KeyRegistry, sha256, signEnvelope } from '../dist/src/contracts/crypto.js';
import {
  createInstrumentedUxFlowSessionV33_30,
  createObserverUxAssessmentV33_30,
  createParticipantConsentV33_30,
  createParticipantSessionAttestationV33_30,
  createUxPilotProtocolV33_30,
  evaluateControlledHumanUxPilotV33_30,
  verifyControlledHumanUxPilotVerdictV33_30,
} from '../dist/src/app/controlled-human-ux-pilot-v33_30.js';

const root=resolve('.'); const out=resolve('release-evidence/v33.30'); mkdirSync(out,{recursive:true});
const write=(name,value)=>writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n');
const read=(rel)=>JSON.parse(readFileSync(resolve(root,rel),'utf8'));
const reg=(...ids)=>{const r=new KeyRegistry();for(const id of ids)r.register(id.keyId,id.publicKey);return r;};
const ids={researcher:generateSigningIdentity('v33.30-researcher'),instrumentation:generateSigningIdentity('v33.30-instrumentation'),observer:generateSigningIdentity('v33.30-observer'),verifier:generateSigningIdentity('v33.30-verifier'),proof:generateSigningIdentity('v33.30-proof'),continuity:generateSigningIdentity('v33.30-metric-continuity')};
const participants=Array.from({length:5},(_,i)=>generateSigningIdentity(`v33.30-simulated-participant-${i+1}`));
const protocolRegistry=reg(ids.researcher), participantRegistry=reg(...participants), instrumentationRegistry=reg(ids.instrumentation), observerRegistry=reg(ids.observer), verifierRegistry=reg(ids.verifier);
const at=new Date('2026-07-22T11:00:00.000Z'); const expires=new Date('2026-08-01T00:00:00.000Z');
const scenarios=['approve-low-risk-change','reject-scope-escalation','request-explanation'];
const protocol=createUxPilotProtocolV33_30({issuer:ids.researcher,studyId:'v33.30-controlled-human-ux-pilot',protocolVersion:'1.0.0',title:'Controlled Human Chat Push UX Pilot',scenarios,consentVersion:'v33.30-consent-1',retentionDays:30,researcherOrganization:'Local Synthetic Research Lab',issuedAt:new Date('2026-07-22T08:00:00.000Z'),expiresAt:expires});
const consents=participants.map((participant,i)=>createParticipantConsentV33_30({participant,protocol,protocolRegistry,trustedResearcherIds:[ids.researcher.keyId],participantId:`simulated-participant-${i+1}`,participantAliasDigest:sha256({simulatedParticipant:i+1}),experienceBand:i===0?'NOVICE':i===1?'EXPERT':'INTERMEDIATE',accessibilityAccommodationCode:i===2?'KEYBOARD_ONLY':'NONE',evidenceClass:'SIMULATED_CONTRACT_TEST',consentedAt:new Date('2026-07-22T08:10:00.000Z'),expiresAt:expires}));
const roleBindings=[
 {keyId:ids.researcher.keyId,role:'RESEARCHER',organization:'Local Synthetic Research Lab',hostId:'local-research-host'},
 {keyId:ids.instrumentation.keyId,role:'INSTRUMENTATION',organization:'Local Telemetry Reference',hostId:'local-telemetry-host'},
 {keyId:ids.observer.keyId,role:'OBSERVER',organization:'Local Independent Observer Reference',hostId:'local-observer-host'},
 {keyId:ids.verifier.keyId,role:'VERIFIER',organization:'Local Independent Verifier Reference',hostId:'local-verifier-host'},
 ...participants.map((p,i)=>({keyId:p.keyId,role:'PARTICIPANT',organization:`Synthetic Participant ${i+1}`,hostId:`synthetic-device-${i+1}`})),
];
function e(id,sequence,eventType,ms,userAction,correct){return{eventId:id,sequence,eventType,occurredAt:new Date(ms).toISOString(),userAction,...(correct===undefined?{}:{correct})};}
function baselineEvents(i){const base=Date.parse(`2026-07-22T09:${String(i).padStart(2,'0')}:00.000Z`);const rows=[e(`b${i}-start`,1,'TASK_STARTED',base,false)];for(let x=0;x<14;x++)rows.push(e(`b${i}-a${x+1}`,x+2,'ACTION_SELECTED',base+(x+1)*1000,true));rows.push(e(`b${i}-done`,16,'TASK_COMPLETED',base+16000,true));return rows;}
function governedEvents(i){const base=Date.parse(`2026-07-22T09:${String(i+20).padStart(2,'0')}:00.000Z`);return[e(`g${i}-start`,1,'TASK_STARTED',base,false),e(`g${i}-instruction`,2,'INSTRUCTION_VIEWED',base+1000,true),e(`g${i}-view`,3,'APPROVAL_VIEWED',base+2000,false),e(`g${i}-answer`,4,'COMPREHENSION_ANSWERED',base+8000,true,true),e(`g${i}-approval`,5,'APPROVAL_SUBMITTED',base+9000,true),e(`g${i}-done`,6,'TASK_COMPLETED',base+10000,true)];}
function makeBundle(i,flow){const participant=participants[i-1],consent=consents[i-1],events=flow==='BASELINE'?baselineEvents(i):governedEvents(i);const session=createInstrumentedUxFlowSessionV33_30({instrumentation:ids.instrumentation,protocol,protocolRegistry,trustedResearcherIds:[ids.researcher.keyId],consent,participantRegistry,trustedParticipantIds:participants.map(p=>p.keyId),sessionId:`${flow.toLowerCase()}-${i}`,scenarioId:scenarios[(i-1)%3],flow,events});const attestation=createParticipantSessionAttestationV33_30({participant,session,sessionRegistry:instrumentationRegistry,trustedInstrumentationIds:[ids.instrumentation.keyId],taskCompleted:true,...(flow==='GOVERNED'?{comprehensionAnswerDigest:sha256({answer:'authority-remains-bounded',i})}:{}),attestedAt:new Date(Date.parse(session.payload.completedAt)+1000)});const assessment=createObserverUxAssessmentV33_30({observer:ids.observer,observerOrganization:'Local Independent Observer Reference',session,sessionRegistry:instrumentationRegistry,trustedInstrumentationIds:[ids.instrumentation.keyId],taskSuccess:true,accessibilityPassed:true,...(flow==='GOVERNED'?{comprehensionCorrect:true}:{}),evidenceArtifactDigest:sha256({flow,i,artifact:'synthetic-observation'}),observedAt:new Date(Date.parse(session.payload.completedAt)+2000)});return{session,participantAttestation:attestation,observerAssessment:assessment};}
const baselineEvidence=Array.from({length:5},(_,i)=>makeBundle(i+1,'BASELINE'));const governedEvidence=Array.from({length:5},(_,i)=>makeBundle(i+1,'GOVERNED'));
const verdict=evaluateControlledHumanUxPilotV33_30({verifier:ids.verifier,protocol,protocolRegistry,trustedResearcherIds:[ids.researcher.keyId],participantRegistry,trustedParticipantIds:participants.map(p=>p.keyId),instrumentationRegistry,trustedInstrumentationIds:[ids.instrumentation.keyId],observerRegistry,trustedObserverIds:[ids.observer.keyId],roleBindings,consents,baselineEvidence,governedEvidence,generatedAt:at});
verifyControlledHumanUxPilotVerdictV33_30({verdict,verifierRegistry,trustedVerifierIds:[ids.verifier.keyId],expectedProtocolDigest:protocol.payload.protocolDigest});
const priorScore=read('release-evidence/v33.29/V33_29_MASTER_PROGRAM_SCORECARD.json').payload;
const priorParameters=read('release-evidence/v33.29/V33_29_PARAMETER_LEDGER.json').payload;
const continuityMaterial={version:'33.30',receiptId:'v33.30-scorecard-continuity',previousScorecardDigest:priorScore.scorecardDigest,previousParameterLedgerDigest:priorParameters.ledgerDigest,metricInventoryCount:54,parameterCount:14,metricDeltas:[
 {metricId:'product-value-operator-ux',priorLocalMaturity:'PARTIAL',currentLocalMaturity:'PARTIAL',externalMaturity:'PENDING',change:'INSTRUMENTATION_AND_GATE_READY_HUMAN_RESULTS_ABSENT'},
 {metricId:'accessibility-human-factors',priorLocalMaturity:'WEAK',currentLocalMaturity:'PARTIAL',externalMaturity:'PENDING',change:'ACCESSIBILITY_MEASUREMENT_AND_FAIL_CLOSED_THRESHOLD_IMPLEMENTED_HUMAN_STUDY_ABSENT'},
 {metricId:'G3',priorLocalMaturity:'PARTIAL',currentLocalMaturity:'PARTIAL',externalMaturity:'PENDING',change:'CONTROLLED_HUMAN_PILOT_INSTRUMENTATION_READY_ZERO_EXTERNAL_PARTICIPANTS'},
 {metricId:'VH-02',priorLocalMaturity:'WEAK',currentLocalMaturity:'WEAK',externalMaturity:'PENDING',change:'HYPOTHESIS_REMAINS_UNPROVEN_SYNTHETIC_METRICS_NOT_COUNTED'},
],externalProgress:{humanPilotParticipants:0,qualifiedRepositories:0,qualifiedMissions:0,buyerInterviews:0,urgentFundedConfirmations:0,designPartners:0,paidPilots:0,annualRecurringRevenueUsd:0},priorityOrder:['G3_CONTROLLED_HUMAN_UX_PILOT','G4_REAL_REPOSITORY_30_MISSION_CAMPAIGN','G2_BUYER_INTERVIEWS_DESIGN_PARTNERS_PAID_PILOTS','G5_ONLY_EXTERNAL_TRUST_CONTROLS_THAT_DIRECTLY_UNBLOCK_THE_PILOT'],generatedAt:at.toISOString(),productionAuthority:'NONE',externalEffectsExecuted:0};
const continuity=signEnvelope({...continuityMaterial,continuityDigest:sha256(continuityMaterial)},ids.continuity);
const proofMaterial={version:'33.30',status:'CONTROLLED_HUMAN_UX_PILOT_INSTRUMENTATION_PROVEN_LOCALLY',focusedTestsExpected:43,studyId:protocol.payload.studyId,syntheticParticipants:5,externalHumanParticipants:0,baselineSessions:5,governedSessions:5,syntheticMetrics:{medianStepReductionPercent:verdict.payload.medianStepReductionPercent,medianGovernedApprovals:verdict.payload.medianGovernedApprovals,medianComprehensionSeconds:verdict.payload.medianComprehensionSeconds,taskSuccessRatePercent:verdict.payload.taskSuccessRatePercent,accessibilityPassRatePercent:verdict.payload.accessibilityPassRatePercent,evidenceClosurePercent:verdict.payload.evidenceClosurePercent},syntheticVerdict:verdict.payload.status,humanPilotPassed:false,metricInventoryCount:54,parameterCount:14,externalProgress:continuityMaterial.externalProgress,productionAuthority:'NONE',externalEffectsExecuted:0,productionPromotion:'blocked'};
const proof=signEnvelope({...proofMaterial,proofDigest:sha256(proofMaterial)},ids.proof);
const publicKeys=Object.entries(ids).map(([role,id])=>({role,...reg(id).exportPublicKey(id.keyId)}));
write('V33_30_UX_PILOT_PROTOCOL.json',protocol);write('V33_30_SYNTHETIC_CONSENTS.json',consents);write('V33_30_SYNTHETIC_BASELINE_EVIDENCE.json',baselineEvidence);write('V33_30_SYNTHETIC_GOVERNED_EVIDENCE.json',governedEvidence);write('V33_30_SYNTHETIC_UX_VERDICT.json',verdict);write('V33_30_METRIC_CONTINUITY_RECEIPT.json',continuity);write('V33_30_CONTROLLED_HUMAN_UX_PILOT_PROOF.json',proof);write('V33_30_PROOF_PUBLIC_KEYS.json',publicKeys);
console.log(JSON.stringify({status:'passed',focusedTestsExpected:43,syntheticMetrics:proofMaterial.syntheticMetrics,syntheticVerdict:proofMaterial.syntheticVerdict,humanPilotPassed:false,externalHumanParticipants:0,metricInventoryCount:54,parameterCount:14,productionPromotion:'blocked'},null,2));
