import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KeyRegistry,
  canonicalJson,
  generateSigningIdentity,
  sha256,
  sha256Bytes,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import {
  createInstrumentedUxFlowSessionV33_30,
  createObserverUxAssessmentV33_30,
  createParticipantConsentV33_30,
  createParticipantSessionAttestationV33_30,
  createParticipantWithdrawalV33_30,
  createUxPilotProtocolV33_30,
  evaluateControlledHumanUxPilotV33_30,
  type UxPilotEventV33_30,
  type UxPilotRoleBindingV33_30,
  type UxSessionEvidenceBundleV33_30,
} from '../src/app/controlled-human-ux-pilot-v33_30.js';
import {
  createExternalHumanPilotEvidenceManifestV33_31,
  createExternalHumanPilotObservationArtifactV33_31,
  createInitialExternalHumanPilotImportCheckpointV33_31,
  enrollExternalHumanPilotRoleV33_31,
  importExternalHumanPilotEvidenceV33_31,
  issueExternalHumanPilotExportChallengeV33_31,
  issueExternalHumanPilotRoleChallengeV33_31,
  respondExternalHumanPilotRoleChallengeV33_31,
  verifyExternalHumanPilotQualificationVerdictV33_31,
  type ExternalHumanPilotArtifactRecordV33_31,
  type ExternalHumanPilotEnrolledRoleV33_31,
  type ExternalHumanPilotEvidenceClassV33_31,
  type ExternalHumanPilotEvidencePackageV33_31,
  type ExternalHumanPilotRoleProofBundleV33_31,
} from '../src/app/external-human-pilot-evidence-import-v33_31.js';

const issuedAt = new Date('2026-07-22T08:00:00.000Z');
const consentedAt = new Date('2026-07-22T08:10:00.000Z');
const roleChallengeAt = new Date('2026-07-22T08:02:00.000Z');
const roleResponseAt = new Date('2026-07-22T08:03:00.000Z');
const roleEnrollmentAt = new Date('2026-07-22T08:04:00.000Z');
const checkpointAt = new Date('2026-07-22T09:40:00.000Z');
const exportChallengeAt = new Date('2026-07-22T09:45:00.000Z');
const exportedAt = new Date('2026-07-22T10:40:00.000Z');
const importedAt = new Date('2026-07-22T11:00:00.000Z');
const expiresAt = new Date('2026-08-01T00:00:00.000Z');
const scenarios = ['approve-low-risk-change','reject-scope-escalation','request-explanation'];

function registry(...ids: SigningIdentity[]): KeyRegistry { const r = new KeyRegistry(); for (const id of ids) r.register(id.keyId, id.publicKey); return r; }
function event(eventId:string, sequence:number, eventType:Omit<UxPilotEventV33_30,'eventDigest'>['eventType'], occurredAt:string, userAction:boolean, correct?:boolean):Omit<UxPilotEventV33_30,'eventDigest'> { return { eventId, sequence, eventType, occurredAt, userAction, ...(correct === undefined ? {} : { correct }) }; }
function baselineEvents(index:number, steps=15) { const base=Date.parse(`2026-07-22T09:${String(index).padStart(2,'0')}:00.000Z`); const rows=[event(`b-${index}-start`,1,'TASK_STARTED',new Date(base).toISOString(),false)]; for(let i=0;i<steps-1;i++) rows.push(event(`b-${index}-a-${i+1}`,i+2,'ACTION_SELECTED',new Date(base+(i+1)*1000).toISOString(),true)); rows.push(event(`b-${index}-done`,steps+1,'TASK_COMPLETED',new Date(base+(steps+1)*1000).toISOString(),true)); return rows; }
function governedEvents(index:number, options:{approvalCount?:number; comprehensionSeconds?:number; correct?:boolean; error?:boolean}={}) { const base=Date.parse(`2026-07-22T09:${String(index+20).padStart(2,'0')}:00.000Z`); const approvals=options.approvalCount??1; const answerAt=base+2000+(options.comprehensionSeconds??6)*1000; const rows=[event(`g-${index}-start`,1,'TASK_STARTED',new Date(base).toISOString(),false),event(`g-${index}-instruction`,2,'INSTRUCTION_VIEWED',new Date(base+1000).toISOString(),true),event(`g-${index}-view`,3,'APPROVAL_VIEWED',new Date(base+2000).toISOString(),false),event(`g-${index}-answer`,4,'COMPREHENSION_ANSWERED',new Date(answerAt).toISOString(),true,options.correct??true)]; let seq=5; for(let i=0;i<approvals;i++) rows.push(event(`g-${index}-approval-${i+1}`,seq++,'APPROVAL_SUBMITTED',new Date(answerAt+1000+i*1000).toISOString(),true)); if(options.error) rows.push(event(`g-${index}-error`,seq++,'ERROR_OBSERVED',new Date(answerAt+5000).toISOString(),false)); rows.push(event(`g-${index}-done`,seq,'TASK_COMPLETED',new Date(answerAt+6000).toISOString(),true)); return rows; }

function fixture(evidenceClass:ExternalHumanPilotEvidenceClassV33_31='LIVE_EXTERNAL', participantCount=5, governedOptions:Parameters<typeof governedEvents>[1]={}) {
  const registrar=generateSigningIdentity('v33.31-registrar');
  const importer=generateSigningIdentity('v33.31-importer');
  const exporter=generateSigningIdentity('v33.31-exporter');
  const researcher=generateSigningIdentity('v33.31-researcher');
  const instrumentation=generateSigningIdentity('v33.31-instrumentation');
  const observer=generateSigningIdentity('v33.31-observer');
  const verifier=generateSigningIdentity('v33.31-verifier');
  const participants=Array.from({length:participantCount},(_,i)=>generateSigningIdentity(`v33.31-participant-${i+1}`));
  const allSubjects=[exporter,researcher,instrumentation,observer,verifier,...participants];
  const registrarRegistry=registry(registrar);
  const importerRegistry=registry(importer);
  const exporterRegistry=registry(exporter);
  const subjectRegistry=registry(...allSubjects);
  const protocolRegistry=registry(researcher);
  const participantRegistry=registry(...participants);
  const instrumentationRegistry=registry(instrumentation);
  const observerRegistry=registry(observer);
  const verifierRegistry=registry(verifier);
  const protocol=createUxPilotProtocolV33_30({issuer:researcher,studyId:'study-v33.31',protocolVersion:'1.0.0',title:'External Human UX Pilot',scenarios,consentVersion:'consent-v33.31',retentionDays:30,researcherOrganization:'Research Sponsor Ltd',issuedAt,expiresAt});
  const consentClass=evidenceClass==='LIVE_EXTERNAL'?'HUMAN_OBSERVED_EXTERNAL' as const:'SIMULATED_CONTRACT_TEST' as const;
  const consents=participants.map((participant,i)=>createParticipantConsentV33_30({participant,protocol,protocolRegistry,trustedResearcherIds:[researcher.keyId],participantId:`participant-${i+1}`,participantAliasDigest:sha256({alias:i+1}),experienceBand:i===0?'NOVICE':i===1?'EXPERT':'INTERMEDIATE',accessibilityAccommodationCode:i===2?'KEYBOARD_ONLY':'NONE',evidenceClass:consentClass,consentedAt,expiresAt}));
  const roleBindings:UxPilotRoleBindingV33_30[]=[
    {keyId:researcher.keyId,role:'RESEARCHER',organization:'Research Sponsor Ltd',hostId:'research-host'},
    {keyId:instrumentation.keyId,role:'INSTRUMENTATION',organization:'Telemetry Systems Ltd',hostId:'telemetry-host'},
    {keyId:observer.keyId,role:'OBSERVER',organization:'Independent UX Lab',hostId:'observer-host'},
    {keyId:verifier.keyId,role:'VERIFIER',organization:'Independent Verification Org',hostId:'verifier-host'},
    ...participants.map((participant,i)=>({keyId:participant.keyId,role:'PARTICIPANT' as const,organization:'Participant Cohort',hostId:`participant-device-${i+1}`})),
  ];
  function roleProof(role:ExternalHumanPilotEnrolledRoleV33_31, subjectId:string, subject:SigningIdentity, organizationId:string, hostId:string):ExternalHumanPilotRoleProofBundleV33_31 {
    const nonce=`role-nonce-${role}-${subjectId}-0123456789abcdef`;
    const challenge=issueExternalHumanPilotRoleChallengeV33_31({registrar,registrarOrganizationId:'External Enrollment Authority',registrarHostId:'registrar-host',subjectRegistry,studyId:protocol.payload.studyId,protocolDigest:protocol.payload.protocolDigest,subjectId,role,organizationId,hostId,keyId:subject.keyId,evidenceClass,nonce,issuedAt:roleChallengeAt,expiresAt});
    const ownershipResponse=respondExternalHumanPilotRoleChallengeV33_31({subject,challenge,registrarRegistry,trustedRegistrarIds:[registrar.keyId],nonce,respondedAt:roleResponseAt});
    const enrollment=enrollExternalHumanPilotRoleV33_31({registrar,challenge,ownershipResponse,registrarRegistry,trustedRegistrarIds:[registrar.keyId],subjectRegistry,trustedSubjectIds:allSubjects.map(row=>row.keyId),enrolledAt:roleEnrollmentAt,expiresAt:new Date('2026-07-31T00:00:00.000Z')});
    return {challenge,ownershipResponse,enrollment};
  }
  const roleProofs=[
    roleProof('RESEARCHER','researcher',researcher,'Research Sponsor Ltd','research-host'),
    roleProof('INSTRUMENTATION','instrumentation',instrumentation,'Telemetry Systems Ltd','telemetry-host'),
    roleProof('OBSERVER','observer',observer,'Independent UX Lab','observer-host'),
    roleProof('VERIFIER','verifier',verifier,'Independent Verification Org','verifier-host'),
    roleProof('EXPORTER','exporter',exporter,'External Evidence Export Org','exporter-host'),
    ...participants.map((participant,i)=>roleProof('PARTICIPANT',`participant-${i+1}`,participant,'Participant Cohort',`participant-device-${i+1}`)),
  ];
  const artifactBytesByPath:Record<string,Uint8Array>={};
  const artifactRecords:ExternalHumanPilotArtifactRecordV33_31[]=[];
  function bundle(index:number, flow:'BASELINE'|'GOVERNED', options:{baselineSteps?:number; scenarioId?:string; taskSuccess?:boolean; accessibilityPassed?:boolean; correct?:boolean; error?:boolean; approvalCount?:number; comprehensionSeconds?:number}={}):UxSessionEvidenceBundleV33_30 {
    const participant=participants[index-1]!; const consent=consents[index-1]!;
    const events=flow==='BASELINE'?baselineEvents(index,options.baselineSteps??15):governedEvents(index,{...governedOptions,...options});
    const session=createInstrumentedUxFlowSessionV33_30({instrumentation,protocol,protocolRegistry,trustedResearcherIds:[researcher.keyId],consent,participantRegistry,trustedParticipantIds:participants.map(row=>row.keyId),sessionId:`${flow.toLowerCase()}-${index}`,scenarioId:options.scenarioId??scenarios[(index-1)%3]!,flow,events});
    const attestedAt=new Date(Date.parse(session.payload.completedAt)+1000);
    const observedAt=new Date(Date.parse(session.payload.completedAt)+2000);
    const taskSuccess=options.taskSuccess??true; const accessibilityPassed=options.accessibilityPassed??true; const correct=options.correct??true; const errorCount=events.filter(row=>row.eventType==='ERROR_OBSERVED').length;
    const participantAttestation=createParticipantSessionAttestationV33_30({participant,session,sessionRegistry:instrumentationRegistry,trustedInstrumentationIds:[instrumentation.keyId],taskCompleted:taskSuccess,...(flow==='GOVERNED'?{comprehensionAnswerDigest:sha256({answer:'bounded-authority',index})}:{}),attestedAt});
    const observation=createExternalHumanPilotObservationArtifactV33_31({protocol:protocol.payload,consent:consent.payload,session:session.payload,observerKeyId:observer.keyId,observerOrganization:'Independent UX Lab',taskSuccess,accessibilityPassed,...(flow==='GOVERNED'?{comprehensionCorrect:correct}:{}),errorCount,observedAt});
    const observerAssessment=createObserverUxAssessmentV33_30({observer,observerOrganization:'Independent UX Lab',session,sessionRegistry:instrumentationRegistry,trustedInstrumentationIds:[instrumentation.keyId],taskSuccess,accessibilityPassed,...(flow==='GOVERNED'?{comprehensionCorrect:correct}:{}),evidenceArtifactDigest:observation.digest,observedAt});
    const path=`observations/${flow.toLowerCase()}-${index}.json`;
    artifactBytesByPath[path]=observation.bytes;
    artifactRecords.push({path,kind:'OBSERVATION_EVIDENCE',mediaType:'application/json',sizeBytes:observation.bytes.byteLength,sha256:observation.digest,sessionDigest:session.payload.sessionDigest,participantId:session.payload.participantId,flow});
    return {session,participantAttestation,observerAssessment};
  }
  const baselineEvidence=Array.from({length:participantCount},(_,i)=>bundle(i+1,'BASELINE'));
  const governedEvidence=Array.from({length:participantCount},(_,i)=>bundle(i+1,'GOVERNED'));
  const exportNonce='external-export-package-nonce-0123456789abcdef';
  const challenge=issueExternalHumanPilotExportChallengeV33_31({importer,importerOrganizationId:'Sovereign Import Authority',importerHostId:'importer-host',exporterRegistry,studyId:protocol.payload.studyId,protocolDigest:protocol.payload.protocolDigest,expectedExporterKeyId:exporter.keyId,nonce:exportNonce,issuedAt:exportChallengeAt,expiresAt:new Date('2026-07-22T12:00:00.000Z')});
  const initialCheckpoint=createInitialExternalHumanPilotImportCheckpointV33_31({signer:importer,generatedAt:checkpointAt});
  function buildPackage(overrides:Partial<Omit<ExternalHumanPilotEvidencePackageV33_31,'manifest'>> & { evidenceClass?:ExternalHumanPilotEvidenceClassV33_31; artifactRecords?:readonly ExternalHumanPilotArtifactRecordV33_31[]; exporterOrganizationId?:string; exporterHostId?:string }={}):ExternalHumanPilotEvidencePackageV33_31 {
    const body={protocol:overrides.protocol??protocol,roleBindings:overrides.roleBindings??roleBindings,roleProofs:overrides.roleProofs??roleProofs,consents:overrides.consents??consents,withdrawals:overrides.withdrawals??[],baselineEvidence:overrides.baselineEvidence??baselineEvidence,governedEvidence:overrides.governedEvidence??governedEvidence,artifactBytesByPath:overrides.artifactBytesByPath??artifactBytesByPath};
    const manifest=createExternalHumanPilotEvidenceManifestV33_31({exporter,exporterOrganizationId:overrides.exporterOrganizationId??'External Evidence Export Org',exporterHostId:overrides.exporterHostId??'exporter-host',challenge,challengeRegistry:importerRegistry,trustedChallengeSignerIds:[importer.keyId],nonce:exportNonce,protocol:body.protocol,evidenceClass:overrides.evidenceClass??evidenceClass,roleBindings:body.roleBindings,roleProofs:body.roleProofs,consents:body.consents,withdrawals:body.withdrawals,baselineEvidence:body.baselineEvidence,governedEvidence:body.governedEvidence,artifactRecords:overrides.artifactRecords??artifactRecords,exportedAt});
    return {...body,manifest};
  }
  const packageValue=buildPackage();
  const trust={registrarRegistry,trustedRegistrarIds:[registrar.keyId],subjectRegistry,trustedSubjectIds:allSubjects.map(row=>row.keyId),challengeRegistry:importerRegistry,trustedChallengeSignerIds:[importer.keyId],exporterRegistry,trustedExporterIds:[exporter.keyId],checkpointRegistry:importerRegistry,trustedCheckpointSignerIds:[importer.keyId]};
  const contractTrust={protocolRegistry,trustedResearcherIds:[researcher.keyId],participantRegistry,trustedParticipantIds:participants.map(row=>row.keyId),instrumentationRegistry,trustedInstrumentationIds:[instrumentation.keyId],observerRegistry,trustedObserverIds:[observer.keyId]};
  function run(pkg=packageValue, checkpoint=initialCheckpoint) { return importExternalHumanPilotEvidenceV33_31({importer,importerOrganizationId:'Sovereign Import Authority',importerHostId:'importer-host',verifier,verifierRegistry,trustedVerifierIds:[verifier.keyId],package:pkg,challenge,previousCheckpoint:checkpoint,trust,contractTrust,importedAt}); }
  return {registrar,importer,exporter,researcher,instrumentation,observer,verifier,participants,protocol,consents,roleBindings,roleProofs,baselineEvidence,governedEvidence,artifactBytesByPath,artifactRecords,challenge,initialCheckpoint,trust,contractTrust,verifierRegistry,packageValue,buildPackage,run};
}

test('v33.30 external label alone no longer authoritatively passes',()=>{const f=fixture();const verdict=evaluateControlledHumanUxPilotV33_30({verifier:f.verifier,protocol:f.protocol,protocolRegistry:f.contractTrust.protocolRegistry,trustedResearcherIds:f.contractTrust.trustedResearcherIds,participantRegistry:f.contractTrust.participantRegistry,trustedParticipantIds:f.contractTrust.trustedParticipantIds,instrumentationRegistry:f.contractTrust.instrumentationRegistry,trustedInstrumentationIds:f.contractTrust.trustedInstrumentationIds,observerRegistry:f.contractTrust.observerRegistry,trustedObserverIds:f.contractTrust.trustedObserverIds,roleBindings:f.roleBindings,consents:f.consents,baselineEvidence:f.baselineEvidence,governedEvidence:f.governedEvidence,generatedAt:importedAt}).payload;assert.equal(verdict.humanPilotPassed,false);assert.equal(verdict.status,'HUMAN_UX_PILOT_EXTERNAL_PROVENANCE_REQUIRED');assert(verdict.blockers.includes('external_evidence_provenance_required'));});
test('live external contract fixture passes only through signed provenance import',()=>{const f=fixture();const result=f.run();assert.equal(result.verdict.payload.humanPilotPassed,true);assert.equal(result.verdict.payload.status,'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY');assert.equal(result.receipt.payload.externalHumanParticipants,5);assert.equal(result.checkpoint.payload.sequence,1);});
test('synthetic reference remains blocked after structurally valid import',()=>{const f=fixture('SYNTHETIC_REFERENCE');const result=f.run();assert.equal(result.verdict.payload.humanPilotPassed,false);assert.equal(result.verdict.payload.status,'HUMAN_UX_PILOT_REQUIRED');assert.equal(result.receipt.payload.externalHumanParticipants,0);});
test('fewer than five live participants remains insufficient',()=>{const f=fixture('LIVE_EXTERNAL',4);const result=f.run();assert.equal(result.verdict.payload.humanPilotPassed,false);assert.equal(result.verdict.payload.status,'HUMAN_UX_PILOT_INSUFFICIENT_EVIDENCE');});
test('threshold failure remains failed even with valid external provenance',()=>{const f=fixture('LIVE_EXTERNAL',5,{comprehensionSeconds:12});const result=f.run();assert.equal(result.verdict.payload.humanPilotPassed,false);assert(result.verdict.payload.blockers.includes('comprehension_time_target_not_met'));});
test('role challenge rejects a short nonce',()=>{const f=fixture();assert.throws(()=>issueExternalHumanPilotRoleChallengeV33_31({registrar:f.registrar,registrarOrganizationId:'r',registrarHostId:'h',subjectRegistry:f.trust.subjectRegistry,studyId:f.protocol.payload.studyId,protocolDigest:f.protocol.payload.protocolDigest,subjectId:'x',role:'EXPORTER',organizationId:'o',hostId:'h2',keyId:f.exporter.keyId,evidenceClass:'LIVE_EXTERNAL',nonce:'short',issuedAt:roleChallengeAt,expiresAt}),/nonce_too_short/);});
test('export challenge rejects a short nonce',()=>{const f=fixture();assert.throws(()=>issueExternalHumanPilotExportChallengeV33_31({importer:f.importer,importerOrganizationId:'i',importerHostId:'h',exporterRegistry:f.trust.exporterRegistry,studyId:f.protocol.payload.studyId,protocolDigest:f.protocol.payload.protocolDigest,expectedExporterKeyId:f.exporter.keyId,nonce:'short',issuedAt:exportChallengeAt,expiresAt}),/nonce_too_short/);});
test('untrusted registrar proof is rejected',()=>{const f=fixture();const trust={...f.trust,trustedRegistrarIds:['other']};assert.throws(()=>importExternalHumanPilotEvidenceV33_31({importer:f.importer,importerOrganizationId:'Sovereign Import Authority',importerHostId:'importer-host',verifier:f.verifier,verifierRegistry:f.verifierRegistry,trustedVerifierIds:[f.verifier.keyId],package:f.packageValue,challenge:f.challenge,previousCheckpoint:f.initialCheckpoint,trust,contractTrust:f.contractTrust,importedAt}),/role_challenge_signature/);});
test('untrusted exporter manifest is rejected',()=>{const f=fixture();const trust={...f.trust,trustedExporterIds:['other']};assert.throws(()=>importExternalHumanPilotEvidenceV33_31({importer:f.importer,importerOrganizationId:'Sovereign Import Authority',importerHostId:'importer-host',verifier:f.verifier,verifierRegistry:f.verifierRegistry,trustedVerifierIds:[f.verifier.keyId],package:f.packageValue,challenge:f.challenge,previousCheckpoint:f.initialCheckpoint,trust,contractTrust:f.contractTrust,importedAt}),/manifest_signature/);});
test('unsigned role-binding alteration breaks manifest binding',()=>{const f=fixture();const altered={...f.packageValue,roleBindings:f.roleBindings.map(row=>row.role==='OBSERVER'?{...row,organization:'Research Sponsor Ltd'}:row)};assert.throws(()=>f.run(altered),/manifest_digest_binding/);});
test('externally attested role binding must match enrollment',()=>{const f=fixture();const bindings=f.roleBindings.map(row=>row.role==='OBSERVER'?{...row,organization:'Forged Observer Org'}:row);const pkg=f.buildPackage({roleBindings:bindings});assert.throws(()=>f.run(pkg),/role_binding_not_attested/);});
test('observer cannot share organization with instrumentation',()=>{const f=fixture();const proof=f.roleProofs.find(row=>row.enrollment.payload.role==='OBSERVER')!;const enrollmentPayload={...proof.enrollment.payload,organizationId:'Telemetry Systems Ltd'};const {enrollmentDigest:_old,...material}=enrollmentPayload;const enrollment=signEnvelope({...material,enrollmentDigest:sha256(material)},f.registrar);const proofs=f.roleProofs.map(row=>row===proof?{...row,enrollment}:row);const bindings=f.roleBindings.map(row=>row.role==='OBSERVER'?{...row,organization:'Telemetry Systems Ltd'}:row);const pkg=f.buildPackage({roleProofs:proofs,roleBindings:bindings});assert.throws(()=>f.run(pkg),/bundle_claim_mismatch|observer_independence/);});
test('missing participant enrollment is rejected',()=>{const f=fixture();const proofs=f.roleProofs.filter(row=>!(row.enrollment.payload.role==='PARTICIPANT'&&row.enrollment.payload.subjectId==='participant-1'));const pkg=f.buildPackage({roleProofs:proofs});assert.throws(()=>f.run(pkg),/participant_count_invalid/);});
test('exporter enrollment must match manifest source identity',()=>{const f=fixture();const pkg=f.buildPackage({exporterOrganizationId:'Forged Export Org'});assert.throws(()=>f.run(pkg),/exporter_enrollment_manifest_binding/);});
test('manifest tamper is rejected',()=>{const f=fixture();const bad={...f.packageValue,manifest:{...f.packageValue.manifest,payload:{...f.packageValue.manifest.payload,participantCount:99}}};assert.throws(()=>f.run(bad),/manifest_signature/);});
test('artifact byte tamper is rejected',()=>{const f=fixture();const bytes={...f.artifactBytesByPath};const path=Object.keys(bytes)[0]!;bytes[path]=Buffer.from('{}');const pkg={...f.packageValue,artifactBytesByPath:bytes};assert.throws(()=>f.run(pkg),/artifact_digest_or_size/);});
test('missing artifact is rejected',()=>{const f=fixture();const bytes={...f.artifactBytesByPath};delete bytes[Object.keys(bytes)[0]!];const pkg={...f.packageValue,artifactBytesByPath:bytes};assert.throws(()=>f.run(pkg),/artifact_inventory/);});
test('extra artifact is rejected',()=>{const f=fixture();const bytes={...f.artifactBytesByPath,'observations/extra.json':Buffer.from('{}')};const pkg={...f.packageValue,artifactBytesByPath:bytes};assert.throws(()=>f.run(pkg),/artifact_inventory/);});
test('observation artifacts reject noncanonical JSON',()=>{const f=fixture();const path=Object.keys(f.artifactBytesByPath)[0]!;const parsed=JSON.parse(Buffer.from(f.artifactBytesByPath[path]!).toString('utf8'));const padded=Buffer.from(JSON.stringify(parsed,null,2));const newDigest=sha256Bytes(padded);const bytes={...f.artifactBytesByPath,[path]:padded};const records=f.artifactRecords.map(row=>row.path===path?{...row,sizeBytes:padded.byteLength,sha256:newDigest}:row);const first=f.baselineEvidence[0]!;const {assessmentDigest:_old,...assessmentMaterial}={...first.observerAssessment.payload,evidenceArtifactDigest:newDigest};const observerAssessment=signEnvelope({...assessmentMaterial,assessmentDigest:sha256(assessmentMaterial)},f.observer);const baselineEvidence=[{...first,observerAssessment},...f.baselineEvidence.slice(1)];const pkg=f.buildPackage({artifactBytesByPath:bytes,artifactRecords:records,baselineEvidence});assert.throws(()=>f.run(pkg),/json_not_canonical/);});
test('artifact record path traversal is rejected before signing',()=>{const f=fixture();const bad=[{...f.artifactRecords[0]!,path:'../escape.json'},...f.artifactRecords.slice(1)];assert.throws(()=>f.buildPackage({artifactRecords:bad}),/artifact_path_invalid/);});
test('opaque artifact not referenced by observer assessment is rejected',()=>{const f=fixture();const records=f.artifactRecords.map((row,i)=>i===0?{...row,sha256:'0'.repeat(64)}:row);const pkg=f.buildPackage({artifactRecords:records});assert.throws(()=>f.run(pkg),/artifact_digest_or_size|artifact_not_referenced/);});
test('challenge replay is rejected by monotonic checkpoint',()=>{const f=fixture();const first=f.run();assert.throws(()=>f.run(f.packageValue,first.checkpoint),/challenge_replay/);});
test('package replay is rejected even if checkpoint lists only package digest',()=>{const f=fixture();const p=f.initialCheckpoint.payload;const material={...p,sequence:1,previousCheckpointDigest:p.checkpointDigest,consumedChallengeDigests:[],consumedPackageDigests:[f.packageValue.manifest.payload.packageDigest],generatedAt:new Date('2026-07-22T10:50:00.000Z').toISOString()};const {checkpointDigest:_old,...without}=material;const checkpoint=signEnvelope({...without,checkpointDigest:sha256(without)},f.importer);assert.throws(()=>f.run(f.packageValue,checkpoint),/package_replay/);});
test('tampered checkpoint is rejected',()=>{const f=fixture();const checkpoint={...f.initialCheckpoint,payload:{...f.initialCheckpoint.payload,sequence:7}};assert.throws(()=>f.run(f.packageValue,checkpoint),/checkpoint_signature/);});
test('expired export challenge is rejected',()=>{const f=fixture();assert.throws(()=>importExternalHumanPilotEvidenceV33_31({importer:f.importer,importerOrganizationId:'Sovereign Import Authority',importerHostId:'importer-host',verifier:f.verifier,verifierRegistry:f.verifierRegistry,trustedVerifierIds:[f.verifier.keyId],package:f.packageValue,challenge:f.challenge,previousCheckpoint:f.initialCheckpoint,trust:f.trust,contractTrust:f.contractTrust,importedAt:new Date('2026-07-22T12:01:00.000Z')}),/challenge_not_active/);});
test('importer identity must match the signed challenge',()=>{const f=fixture();assert.throws(()=>importExternalHumanPilotEvidenceV33_31({importer:f.importer,importerOrganizationId:'Wrong Import Org',importerHostId:'importer-host',verifier:f.verifier,verifierRegistry:f.verifierRegistry,trustedVerifierIds:[f.verifier.keyId],package:f.packageValue,challenge:f.challenge,previousCheckpoint:f.initialCheckpoint,trust:f.trust,contractTrust:f.contractTrust,importedAt}),/importer_challenge_binding/);});
test('verifier must match externally enrolled verifier key',()=>{const f=fixture();const attacker=generateSigningIdentity('attacker-verifier');const attackerRegistry=registry(attacker);assert.throws(()=>importExternalHumanPilotEvidenceV33_31({importer:f.importer,importerOrganizationId:'Sovereign Import Authority',importerHostId:'importer-host',verifier:attacker,verifierRegistry:attackerRegistry,trustedVerifierIds:[attacker.keyId],package:f.packageValue,challenge:f.challenge,previousCheckpoint:f.initialCheckpoint,trust:f.trust,contractTrust:f.contractTrust,importedAt}),/verifier_enrollment_key_mismatch|participant_staff_overlap/);});
test('withdrawal evidence is excluded and blocks minimum count',()=>{const f=fixture();const withdrawal=createParticipantWithdrawalV33_30({participant:f.participants[0]!,consent:f.consents[0]!,participantRegistry:f.contractTrust.participantRegistry,withdrawnAt:new Date('2026-07-22T10:30:00.000Z'),reasonCode:'PARTICIPANT_REQUEST'});const pkg=f.buildPackage({withdrawals:[withdrawal]});const result=f.run(pkg);assert.equal(result.verdict.payload.humanPilotPassed,false);assert(result.verdict.payload.blockers.includes('withdrawn_participant_evidence_excluded'));});
test('qualification verdict signature and bindings verify',()=>{const f=fixture();const result=f.run();const payload=verifyExternalHumanPilotQualificationVerdictV33_31({verdict:result.verdict,verifierRegistry:f.verifierRegistry,trustedVerifierIds:[f.verifier.keyId],expectedProtocolDigest:f.protocol.payload.protocolDigest,expectedPackageDigest:f.packageValue.manifest.payload.packageDigest});assert.equal(payload.humanPilotPassed,true);});
test('tampered qualification verdict is rejected',()=>{const f=fixture();const result=f.run();const bad={...result.verdict,payload:{...result.verdict.payload,externalProvenanceVerified:false}};assert.throws(()=>verifyExternalHumanPilotQualificationVerdictV33_31({verdict:bad,verifierRegistry:f.verifierRegistry,trustedVerifierIds:[f.verifier.keyId],expectedProtocolDigest:f.protocol.payload.protocolDigest,expectedPackageDigest:f.packageValue.manifest.payload.packageDigest}),/verdict_signature/);});
test('all import outputs remain shadow-only with zero effects',()=>{const f=fixture();const result=f.run();assert.equal(result.receipt.payload.productionAuthority,'NONE');assert.equal(result.receipt.payload.externalEffectsExecuted,0);assert.equal(result.checkpoint.payload.externalEffectsExecuted,0);assert.equal(result.verdict.payload.productionAuthority,'NONE');assert.equal(result.verdict.payload.externalEffectsExecuted,0);});
