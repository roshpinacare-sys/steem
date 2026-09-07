import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import {
  DeviceBindingRegistry,
  type DeviceEnrollmentGrant,
} from '../src/product/device-push-v33_3.js';
import type { HumanPilotObservationV33_6 } from '../src/product/human-pilot-readiness-v33_6.js';
import {
  BuyerEvidenceVerifierV33_7,
  ControlledHumanPilotRegistryV33_7,
  ExternalProviderVerifierV33_7,
  createControlledPilotProtocolV33_7,
  createV33_7ReadinessSummary,
  type BuyerEvidenceV33_7,
  type ControlledPilotObservationV33_7,
  type ParticipantConsentV33_7,
  type ProviderQualificationRunV33_7,
  type ProviderQualificationWitnessV33_7,
} from '../src/product/controlled-pilot-and-market-v33_7.js';

const now = new Date('2026-07-21T08:00:00.000Z');

interface Fixture {
  authority: SigningIdentity;
  observer: SigningIdentity;
  device: SigningIdentity;
  registrar: SigningIdentity;
  authorityKeys: KeyRegistry;
  observerKeys: KeyRegistry;
  devices: DeviceBindingRegistry;
  registry: ControlledHumanPilotRegistryV33_7;
  enrollmentDigest: string;
  protocol: ReturnType<typeof createControlledPilotProtocolV33_7>;
}

function fixture(): Fixture {
  const authority = generateSigningIdentity('study-authority');
  const observer = generateSigningIdentity('independent-observer');
  const device = generateSigningIdentity('participant-device');
  const registrar = generateSigningIdentity('device-registrar');
  const authorityKeys = keys(authority);
  const observerKeys = keys(observer);
  const registrarKeys = keys(registrar);
  const deviceKeys = keys(device);
  const devices = new DeviceBindingRegistry(registrarKeys, [registrar.keyId]);
  const enrollment: DeviceEnrollmentGrant = {
    version: '33.3', enrollmentId: 'device-enrollment-1', tenantId: 'tenant-pilot', userId: 'pilot-user-1', deviceId: 'pilot-phone-1', channel: 'SIMULATED_PUSH',
    devicePublicKey: deviceKeys.exportPublicKey(device.keyId), capabilities: ['APPROVAL_RECEIVE','APPROVAL_DECIDE'], issuedAt: '2026-07-21T07:00:00.000Z', notBefore: '2026-07-21T07:00:00.000Z', notAfter: '2026-07-22T08:00:00.000Z', nonce: 'device-enrollment-nonce-1', productionCeiling: 'shadow',
  };
  const signedEnrollment = signEnvelope(enrollment, registrar);
  devices.enroll(signedEnrollment, now);
  const registry = new ControlledHumanPilotRegistryV33_7({ authorityKeys, trustedAuthorityIds: [authority.keyId], observerKeys, trustedObserverIds: [observer.keyId], devices });
  const protocol = protocolEnvelope(authority, observer.keyId);
  registry.registerProtocol(protocol, now);
  return { authority, observer, device, registrar, authorityKeys, observerKeys, devices, registry, enrollmentDigest: sha256(signedEnrollment), protocol };
}

function protocolEnvelope(authority: SigningIdentity, observerId: string, overrides: Partial<Parameters<typeof createControlledPilotProtocolV33_7>[0]> = {}) {
  return createControlledPilotProtocolV33_7({
    studyId: 'study-33.7', tenantId: 'tenant-pilot', protocolRevision: 1, scenarioIds: ['approve-low-risk','reject-scope-escalation','request-explanation'], minimumParticipants: 5, maximumParticipants: 12, requiredObserverIds: [observerId], consentTextDigest: sha256('consent-v1'), telemetryFields: ['eventType','occurredAt','userStepIncrement','comprehensionSeconds'], retentionDays: 30,
    thresholds: { minimumStepReductionPct: 70, maximumMedianApprovals: 1, maximumMedianComprehensionSeconds: 10, maximumErrorRatePct: 5, accessibilityRequired: true }, issuedAt: '2026-07-21T07:30:00.000Z', expiresAt: '2026-08-21T08:00:00.000Z', ...overrides,
  }, authority);
}

function consentEnvelope(f: Fixture, index = 1, overrides: Partial<ParticipantConsentV33_7> = {}) {
  const material = {
    version: '33.7' as const, enrollmentId: `participant-enrollment-${index}`, studyId: f.protocol.payload.studyId, protocolDigest: f.protocol.payload.protocolDigest, tenantId: 'tenant-pilot', participantAlias: `participant-${index}`, userId: 'pilot-user-1', deviceId: 'pilot-phone-1', deviceEnrollmentDigest: f.enrollmentDigest, consentTextDigest: f.protocol.payload.consentTextDigest, consentedAt: '2026-07-21T07:50:00.000Z', expiresAt: '2026-07-22T08:00:00.000Z', dataMinimizationAccepted: true as const, withdrawalAvailable: true as const, noDirectPersonalIdentifiers: true as const, nonce: `participant-consent-nonce-${index}`, externalEffectsExecuted: 0 as const, ...overrides,
  };
  const payload: ParticipantConsentV33_7 = { ...material, consentDigest: sha256(material) };
  return signEnvelope(payload, f.device);
}

function baseObservation(observer: SigningIdentity, participant: string, scenario: string, index: number, overrides: Partial<HumanPilotObservationV33_6> = {}): SignedEnvelope<HumanPilotObservationV33_6> {
  const material = { version: '33.6' as const, observationId: `base-observation-${index}`, scenarioId: scenario, participantId: participant, sessionDigest: sha256(`session-${index}`), telemetryTailDigest: sha256(`telemetry-${index}`), consentReceiptDigest: sha256(`consent-${index}`), baselineSteps: 10, prototypeSteps: 2, approvals: 1, comprehensionSeconds: 6 + index / 10, errors: 0, accessibilityPassed: true, sessionRevokedDuringFlow: false as const, observerId: observer.keyId, observedAt: '2026-07-21T07:55:00.000Z', evidenceClass: 'HUMAN_OBSERVED' as const, externalEffectsExecuted: 0 as const, ...overrides };
  const payload: HumanPilotObservationV33_6 = { ...material, observationDigest: sha256(material) };
  return signEnvelope(payload, observer);
}

function controlledObservation(f: Fixture, consent: SignedEnvelope<ParticipantConsentV33_7>, base: SignedEnvelope<HumanPilotObservationV33_6>, index: number, overrides: Partial<ControlledPilotObservationV33_7> = {}) {
  const material = { version: '33.7' as const, controlledObservationId: `controlled-observation-${index}`, studyId: f.protocol.payload.studyId, protocolDigest: f.protocol.payload.protocolDigest, enrollmentDigest: sha256(consent), baseObservationDigest: sha256(base), participantAlias: consent.payload.participantAlias, scenarioId: base.payload.scenarioId, observerId: f.observer.keyId, observerOrganization: 'Independent Assurance Lab', observedAt: base.payload.observedAt, externalEffectsExecuted: 0 as const, ...overrides };
  const payload: ControlledPilotObservationV33_7 = { ...material, controlledObservationDigest: sha256(material) };
  return signEnvelope(payload, f.observer);
}

function enrollDistinctParticipant(f: Fixture, index: number): SignedEnvelope<ParticipantConsentV33_7> {
  if (index === 1) { const consent = consentEnvelope(f, 1); f.registry.enrollParticipant(consent, now); return consent; }
  const device = generateSigningIdentity(`participant-device-${index}`);
  const deviceKeys = keys(device);
  const enrollment: DeviceEnrollmentGrant = { version:'33.3', enrollmentId:`device-enrollment-${index}`, tenantId:'tenant-pilot', userId:`pilot-user-${index}`, deviceId:`pilot-phone-${index}`, channel:'SIMULATED_PUSH', devicePublicKey:deviceKeys.exportPublicKey(device.keyId), capabilities:['APPROVAL_RECEIVE','APPROVAL_DECIDE'], issuedAt:'2026-07-21T07:00:00.000Z', notBefore:'2026-07-21T07:00:00.000Z', notAfter:'2026-07-22T08:00:00.000Z', nonce:`device-enrollment-nonce-${index}`, productionCeiling:'shadow' };
  const signedEnrollment = signEnvelope(enrollment, f.registrar); f.devices.enroll(signedEnrollment, now);
  const material = { version:'33.7' as const, enrollmentId:`participant-enrollment-${index}`, studyId:f.protocol.payload.studyId, protocolDigest:f.protocol.payload.protocolDigest, tenantId:'tenant-pilot', participantAlias:`participant-${index}`, userId:`pilot-user-${index}`, deviceId:`pilot-phone-${index}`, deviceEnrollmentDigest:sha256(signedEnrollment), consentTextDigest:f.protocol.payload.consentTextDigest, consentedAt:'2026-07-21T07:50:00.000Z', expiresAt:'2026-07-22T08:00:00.000Z', dataMinimizationAccepted:true as const, withdrawalAvailable:true as const, noDirectPersonalIdentifiers:true as const, nonce:`participant-consent-nonce-${index}`, externalEffectsExecuted:0 as const };
  const payload:ParticipantConsentV33_7={...material,consentDigest:sha256(material)}; const signed=signEnvelope(payload,device); f.registry.enrollParticipant(signed,now); return signed;
}

function keys(identity: SigningIdentity): KeyRegistry { const registry = new KeyRegistry(); registry.register(identity.keyId, identity.publicKey); return registry; }

// Controlled human pilot protocol and consent
test('controlled pilot protocol is signed immutable shadow-only and privacy bounded', () => { const f=fixture(); assert.equal(f.authorityKeys.verifyAt(f.protocol,now),true); assert.equal(f.protocol.payload.productionCeiling,'shadow'); assert.equal(f.protocol.payload.retentionDays,30); assert.equal(f.registry.registerProtocol(f.protocol,now).protocolDigest,f.protocol.payload.protocolDigest); });
test('study authority cannot also be the independent observer', () => { const identity=generateSigningIdentity('same-role'); const k=keys(identity); const registrar=generateSigningIdentity('r'); const devices=new DeviceBindingRegistry(keys(registrar),[registrar.keyId]); assert.throws(()=>new ControlledHumanPilotRegistryV33_7({authorityKeys:k,trustedAuthorityIds:[identity.keyId],observerKeys:k,trustedObserverIds:[identity.keyId],devices}),/separation_required/); });
test('protocol rejects PII telemetry fields and excessive retention', () => { const authority=generateSigningIdentity('authority-x'); const observer=generateSigningIdentity('observer-x'); const registrar=generateSigningIdentity('registrar-x'); const devices=new DeviceBindingRegistry(keys(registrar),[registrar.keyId]); const registry=new ControlledHumanPilotRegistryV33_7({authorityKeys:keys(authority),trustedAuthorityIds:[authority.keyId],observerKeys:keys(observer),trustedObserverIds:[observer.keyId],devices}); assert.throws(()=>registry.registerProtocol(protocolEnvelope(authority,observer.keyId,{telemetryFields:['email'],retentionDays:120}),now),/pii_forbidden|retention_excessive/); });
test('protocol cannot be replaced under the same study id', () => { const f=fixture(); const changed=protocolEnvelope(f.authority,f.observer.keyId,{retentionDays:29}); assert.throws(()=>f.registry.registerProtocol(changed,now),/immutable/); });
test('participant consent requires the enrolled device signature and exact protocol', () => { const f=fixture(); const consent=consentEnvelope(f); assert.equal(f.registry.enrollParticipant(consent,now).participantAlias,'participant-1'); const attacker=generateSigningIdentity('attacker'); assert.throws(()=>f.registry.enrollParticipant(signEnvelope(consent.payload,attacker),now),/device_signature_invalid/); });
test('consent cannot claim raw identity fields or outlive the protocol', () => { const f=fixture(); const bad=consentEnvelope(f,1,{expiresAt:'2026-09-01T00:00:00.000Z'}); assert.throws(()=>f.registry.enrollParticipant(bad,now),/consent_window_invalid/); });
test('one device cannot manufacture multiple human participants', () => { const f=fixture(); f.registry.enrollParticipant(consentEnvelope(f,1),now); const second=consentEnvelope(f,2,{participantAlias:'participant-2'}); assert.throws(()=>f.registry.enrollParticipant(second,now),/device_shared/); });
test('participant aliases cannot be rebound to a second enrollment', () => { const f=fixture(); f.registry.enrollParticipant(consentEnvelope(f,1),now); const retry=consentEnvelope(f,2,{participantAlias:'participant-1'}); assert.throws(()=>f.registry.enrollParticipant(retry,now),/alias_reuse|device_shared/); });

// Observation binding and G3 controlled gate
test('controlled observation binds protocol consent base evidence and independent observer', () => { const f=fixture(); const consent=enrollDistinctParticipant(f,1); const base=baseObservation(f.observer,'participant-1','approve-low-risk',1); const controlled=controlledObservation(f,consent,base,1); assert.equal(f.registry.addObservation({envelope:controlled,baseObservation:base},now).scenarioId,'approve-low-risk'); });
test('controlled observation rejects a mismatched base observation or scenario', () => { const f=fixture(); const consent=enrollDistinctParticipant(f,1); const base=baseObservation(f.observer,'participant-1','approve-low-risk',1); const changed=controlledObservation(f,consent,base,1,{scenarioId:'reject-scope-escalation'}); assert.throws(()=>f.registry.addObservation({envelope:changed,baseObservation:base},now),/base_mismatch/); });
test('controlled observation rejects a fake observer signature', () => { const f=fixture(); const consent=enrollDistinctParticipant(f,1); const base=baseObservation(f.observer,'participant-1','approve-low-risk',1); const payload=controlledObservation(f,consent,base,1).payload; const fake=generateSigningIdentity('fake-observer'); assert.throws(()=>f.registry.addObservation({envelope:signEnvelope(payload,fake),baseObservation:base},now),/observer_untrusted|signature_invalid/); });
test('same participant and scenario cannot be counted twice', () => { const f=fixture(); const consent=enrollDistinctParticipant(f,1); const base=baseObservation(f.observer,'participant-1','approve-low-risk',1); f.registry.addObservation({envelope:controlledObservation(f,consent,base,1),baseObservation:base},now); const base2=baseObservation(f.observer,'participant-1','approve-low-risk',2); assert.throws(()=>f.registry.addObservation({envelope:controlledObservation(f,consent,base2,2),baseObservation:base2},now),/duplicate_participant_scenario/); });
test('five distinct consented participants with protocol coverage can pass controlled human gate', () => { const f=fixture(); const bases:SignedEnvelope<HumanPilotObservationV33_6>[]=[]; const scenarios=['approve-low-risk','reject-scope-escalation','request-explanation','approve-low-risk','reject-scope-escalation']; for(let i=1;i<=5;i++){const consent=enrollDistinctParticipant(f,i);const base=baseObservation(f.observer,`participant-${i}`,scenarios[i-1]!,i);bases.push(base);f.registry.addObservation({envelope:controlledObservation(f,consent,base,i),baseObservation:base},now);} const gate=f.registry.evaluate(f.protocol.payload.studyId,bases); assert.equal(gate.humanPilotPassed,true); assert.equal(gate.participantCount,5); assert.equal(gate.stepReductionPct,80); assert.equal(gate.productionCeiling,'shadow'); });
test('four participants cannot pass even with good metrics', () => { const f=fixture(); const bases:SignedEnvelope<HumanPilotObservationV33_6>[]=[]; const scenarios=['approve-low-risk','reject-scope-escalation','request-explanation','approve-low-risk']; for(let i=1;i<=4;i++){const consent=enrollDistinctParticipant(f,i);const base=baseObservation(f.observer,`participant-${i}`,scenarios[i-1]!,i);bases.push(base);f.registry.addObservation({envelope:controlledObservation(f,consent,base,i),baseObservation:base},now);} assert.equal(f.registry.evaluate(f.protocol.payload.studyId,bases).humanPilotPassed,false); });
test('slow comprehension or accessibility failure blocks the gate', () => { const f=fixture(); const bases:SignedEnvelope<HumanPilotObservationV33_6>[]=[]; const scenarios=['approve-low-risk','reject-scope-escalation','request-explanation','approve-low-risk','reject-scope-escalation']; for(let i=1;i<=5;i++){const consent=enrollDistinctParticipant(f,i);const base=baseObservation(f.observer,`participant-${i}`,scenarios[i-1]!,i,{comprehensionSeconds:12,accessibilityPassed:i!==5});bases.push(base);f.registry.addObservation({envelope:controlledObservation(f,consent,base,i),baseObservation:base},now);} assert.equal(f.registry.evaluate(f.protocol.payload.studyId,bases).humanPilotPassed,false); });

// Credentialled external provider qualification
function providerFixture(){const operator=generateSigningIdentity('provider-operator');const witness=generateSigningIdentity('provider-witness');const verifier=new ExternalProviderVerifierV33_7({operatorKeys:keys(operator),trustedOperatorIds:[operator.keyId],witnessKeys:keys(witness),trustedWitnessIds:[witness.keyId]});return{operator,witness,verifier};}
function providerRun(operator:SigningIdentity,overrides:Partial<ProviderQualificationRunV33_7>={}){const material={version:'33.7' as const,runId:'provider-run-1',provider:'FCM' as const,environment:'FCM_ISOLATED_PROJECT' as const,endpoint:'https://fcm.googleapis.com/v1/projects/pilot-project/messages:send',credentialReference:'workload://push/fcm-sender',authentication:'FCM_OAUTH2_ACCESS_TOKEN' as const,tlsVersion:'TLS1.3' as const,tlsPeerFingerprint:sha256('tls-peer'),realDeviceObserved:true as const,externalNetworkExecuted:true as const,credentialMaterialDisclosed:false as const,requestCount:3,providerAcceptanceCount:2,duplicateAcceptanceCount:0 as const,invalidTokenHandled:true as const,retryDedupPassed:true as const,deviceTokenRotationPassed:true as const,providerCredentialRevocationPassed:true as const,transcriptDigest:sha256('network-transcript'),operatorId:operator.keyId,operatorOrganization:'Delivery Operator Ltd',startedAt:'2026-07-21T07:30:00.000Z',completedAt:'2026-07-21T07:45:00.000Z',productionCeiling:'shadow' as const,externalEffectsExecuted:0 as const,...overrides};const payload:ProviderQualificationRunV33_7={...material,runDigest:sha256(material)};return signEnvelope(payload,operator);}
function providerWitness(witness:SigningIdentity,run:SignedEnvelope<ProviderQualificationRunV33_7>,overrides:Partial<ProviderQualificationWitnessV33_7>={}){const material={version:'33.7' as const,witnessId:'witness-1',runDigest:sha256(run),provider:run.payload.provider,tlsPeerFingerprint:run.payload.tlsPeerFingerprint,transcriptDigest:run.payload.transcriptDigest,witnessOrganization:'Independent Network Lab',observedAt:'2026-07-21T07:46:00.000Z',externalEffectsExecuted:0 as const,...overrides};const payload:ProviderQualificationWitnessV33_7={...material,witnessDigest:sha256(material)};return signEnvelope(payload,witness);}
test('credentialled FCM qualification requires an independent signed witness',()=>{const f=providerFixture();const run=providerRun(f.operator);const witness=providerWitness(f.witness,run);const gate=f.verifier.verify(run,witness,now);assert.equal(gate.qualified,true);assert.equal(gate.productionCeiling,'shadow');});
test('same organization cannot self-qualify a provider run',()=>{const f=providerFixture();const run=providerRun(f.operator,{operatorOrganization:'Same Org'});const witness=providerWitness(f.witness,run,{witnessOrganization:'Same Org'});assert.equal(f.verifier.verify(run,witness,now).qualified,false);});
test('provider qualification rejects raw credentials and wrong endpoint',()=>{const f=providerFixture();const run=providerRun(f.operator,{credentialReference:'env://raw-key',endpoint:'https://evil.example/messages:send'});const witness=providerWitness(f.witness,run);assert.throws(()=>f.verifier.verify(run,witness,now),/credential_reference_invalid|fcm_qualification/);});
test('provider qualification rejects witness transcript substitution',()=>{const f=providerFixture();const run=providerRun(f.operator);const witness=providerWitness(f.witness,run,{transcriptDigest:sha256('other')});assert.throws(()=>f.verifier.verify(run,witness,now),/witness_binding_invalid/);});
test('provider qualification rejects duplicate provider acceptance or failed revocation',()=>{const f=providerFixture();const run=providerRun(f.operator,{duplicateAcceptanceCount:1 as 0,providerCredentialRevocationPassed:false as true});const witness=providerWitness(f.witness,run);assert.throws(()=>f.verifier.verify(run,witness,now),/controls_failed/);});

// G2 buyer and design-partner proof
function buyerEvidence(interviewer:SigningIdentity,index:number,type:'INTERVIEW'|'DESIGN_PARTNER'|'PAID_PILOT'='INTERVIEW',overrides:Partial<BuyerEvidenceV33_7>={}){const material={version:'33.7' as const,evidenceId:`buyer-evidence-${type}-${index}`,organizationAlias:`org-${index}`,buyerRole:'VP Engineering',evidenceType:type,problemUrgent:index<=5,budgetOwnerConfirmed:index<=5,currentWorkaroundDigest:sha256(`workaround-${index}`),evidenceArtifactDigest:sha256(`artifact-${type}-${index}`),...(type==='PAID_PILOT'?{annualContractValueUsd:25_000}:{}),interviewerId:interviewer.keyId,collectedAt:'2026-07-21T07:00:00.000Z',expiresAt:'2027-01-21T07:00:00.000Z',evidenceClass:'EXTERNAL_BUYER_EVIDENCE' as const,...overrides};const payload:BuyerEvidenceV33_7={...material,evidenceDigest:sha256(material)};return signEnvelope(payload,interviewer);}
test('G2 gate passes only with 15 interviews 3 design partners and 2 paid pilots',()=>{const interviewer=generateSigningIdentity('buyer-researcher');const verifier=new BuyerEvidenceVerifierV33_7(keys(interviewer),[interviewer.keyId]);const rows=[];for(let i=1;i<=15;i++)rows.push(buyerEvidence(interviewer,i));rows.push(buyerEvidence(interviewer,1,'PAID_PILOT'));rows.push(buyerEvidence(interviewer,2,'PAID_PILOT'));rows.push(buyerEvidence(interviewer,3,'DESIGN_PARTNER'));const gate=verifier.evaluate(rows,now);assert.equal(gate.g2Passed,true);assert.equal(gate.interviews,15);assert.equal(gate.paidPilots,2);assert.equal(gate.designPartners,3);assert.equal(gate.committedPilotAcvUsd,50_000);});
test('G2 gate stays blocked without paid pilots',()=>{const interviewer=generateSigningIdentity('buyer-researcher');const verifier=new BuyerEvidenceVerifierV33_7(keys(interviewer),[interviewer.keyId]);const rows=Array.from({length:15},(_,i)=>buyerEvidence(interviewer,i+1));assert.equal(verifier.evaluate(rows,now).g2Passed,false);});
test('the same organization cannot be counted as multiple design partners',()=>{const interviewer=generateSigningIdentity('buyer-researcher');const verifier=new BuyerEvidenceVerifierV33_7(keys(interviewer),[interviewer.keyId]);const rows=Array.from({length:15},(_,i)=>buyerEvidence(interviewer,i+1));rows.push(buyerEvidence(interviewer,1,'DESIGN_PARTNER'));rows.push(buyerEvidence(interviewer,1,'PAID_PILOT',{evidenceId:'paid-same-org'}));const gate=verifier.evaluate(rows,now);assert.equal(gate.designPartners,1);assert.equal(gate.paidPilots,1);assert.equal(gate.g2Passed,false);});
test('buyer evidence rejects unsigned or duplicated artifacts',()=>{const interviewer=generateSigningIdentity('buyer-researcher');const attacker=generateSigningIdentity('attacker');const verifier=new BuyerEvidenceVerifierV33_7(keys(interviewer),[interviewer.keyId]);const row=buyerEvidence(interviewer,1);assert.throws(()=>verifier.evaluate([signEnvelope(row.payload,attacker)],now),/signature_invalid/);assert.throws(()=>verifier.evaluate([row,row],now),/id_duplicate/);});
test('paid pilot evidence requires at least 25k ACV and forbids value on interviews',()=>{const interviewer=generateSigningIdentity('buyer-researcher');const verifier=new BuyerEvidenceVerifierV33_7(keys(interviewer),[interviewer.keyId]);assert.throws(()=>verifier.evaluate([buyerEvidence(interviewer,1,'PAID_PILOT',{annualContractValueUsd:10_000})],now),/paid_pilot_value_invalid/);assert.throws(()=>verifier.evaluate([buyerEvidence(interviewer,1,'INTERVIEW',{annualContractValueUsd:25_000})],now),/non_paid_evidence/);});
test('V33.7 readiness summary refuses to claim human provider or buyer execution',()=>{const summary=createV33_7ReadinessSummary();assert.equal(summary.controlledHumanPilot,'not_executed');assert.equal(summary.credentialledProviderQualification,'not_executed');assert.equal(summary.buyerValidation,'not_executed');assert.equal(summary.gates.G2,'in-progress-not-passed');assert.equal(summary.gates.G3,'in-progress-not-passed');assert.equal(summary.productionPromotion,'blocked');});
