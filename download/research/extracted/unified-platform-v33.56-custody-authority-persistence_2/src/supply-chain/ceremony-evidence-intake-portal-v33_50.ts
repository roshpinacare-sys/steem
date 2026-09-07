import { KeyRegistry, sha256, sha256Bytes, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { CoordinatorDeploymentRoleV33_48 } from './external-coordinator-deployment-evidence-import-v33_48.js';
import type {
  CeremonyActorV33_49,
  CeremonyEnrollmentResponsePayloadV33_49,
  CeremonyExecutionReceiptV33_49,
} from './external-ceremony-executor-v33_49.js';

export type IntakeExecutionClassV33_50 = 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
export type IntakeScanStatusV33_50 = 'BUILTIN_CLEAN_QUARANTINED' | 'EXTERNAL_QUALIFIED_CLEAN' | 'REJECTED';
export type IntakeReadinessStatusV33_50 =
  | 'LOCAL_CEREMONY_INTAKE_COMPLETE_REHEARSAL_ONLY'
  | 'EXTERNAL_CEREMONY_EVIDENCE_READY_FOR_IMPORT';

export interface IntakePortalPolicyPayloadV33_50 {
  readonly version: '33.50';
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly baseCeremonyReceiptDigest: string;
  readonly authority: CeremonyActorV33_49;
  readonly authorizedEnrollmentResponseDigests: readonly string[];
  readonly requiredRoleCount: 16;
  readonly requiredExternalInfrastructureAttestations: 22;
  readonly replacementApprovalQuorum: 3;
  readonly channelTtlSeconds: number;
  readonly maximumFilesPerRole: number;
  readonly maximumBytesPerRole: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly policyDigest: string;
}

export interface MutualAuthChannelPayloadV33_50 {
  readonly version: '33.50';
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly policyDigest: string;
  readonly role: CoordinatorDeploymentRoleV33_48;
  readonly ordinal: number;
  readonly roleActor: CeremonyActorV33_49;
  readonly transportSignerKeyId: string;
  readonly portalActor: CeremonyActorV33_49;
  readonly clientCertificateFingerprint: string;
  readonly serverCertificateFingerprint: string;
  readonly tlsExporterBindingDigest: string;
  readonly nonceDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly oneSubmissionOnly: true;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly channelDigest: string;
}

export interface IntakeArtifactRecordV33_50 {
  readonly path: string;
  readonly mediaType: 'application/json' | 'text/plain' | 'application/octet-stream';
  readonly byteLength: number;
  readonly sha256: string;
}

export interface RoleEvidenceSubmissionPayloadV33_50 {
  readonly version: '33.50';
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly policyDigest: string;
  readonly channelDigest: string;
  readonly enrollmentResponseDigest: string;
  readonly role: CoordinatorDeploymentRoleV33_48;
  readonly ordinal: number;
  readonly actor: CeremonyActorV33_49;
  readonly executionClass: IntakeExecutionClassV33_50;
  readonly files: readonly IntakeArtifactRecordV33_50[];
  readonly externalAttestationDigests: readonly string[];
  readonly submittedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly submissionDigest: string;
}

export interface IntakeScanFindingV33_50 {
  readonly path: string;
  readonly ruleId: 'EICAR' | 'PRIVATE_KEY' | 'EXECUTABLE_MAGIC' | 'ACTIVE_SCRIPT' | 'MEDIA_TYPE_MISMATCH';
  readonly detailDigest: string;
}

export interface IntakeMalwareScanPayloadV33_50 {
  readonly version: '33.50';
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly submissionDigest: string;
  readonly scannerActor: CeremonyActorV33_49;
  readonly scannerEngine: 'BUILTIN_STATIC_V33_50' | 'EXTERNAL_QUALIFIED_SCANNER';
  readonly externalScannerAttestationDigest: string | null;
  readonly findings: readonly IntakeScanFindingV33_50[];
  readonly scannedFileCount: number;
  readonly scannedBytes: number;
  readonly status: IntakeScanStatusV33_50;
  readonly scannedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly scanDigest: string;
}

export interface QuarantineReceiptPayloadV33_50 {
  readonly version: '33.50';
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly policyDigest: string;
  readonly role: CoordinatorDeploymentRoleV33_48;
  readonly ordinal: number;
  readonly actor: CeremonyActorV33_49;
  readonly channelDigest: string;
  readonly submissionDigest: string;
  readonly scanDigest: string;
  readonly executionClass: IntakeExecutionClassV33_50;
  readonly externalAttestationDigests: readonly string[];
  readonly quarantineStatus: 'SCAN_PASSED_QUARANTINED';
  readonly eligibleForLocalReadiness: true;
  readonly eligibleForExternalReadiness: boolean;
  readonly acceptedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface RoleReplacementApprovalPayloadV33_50 {
  readonly version: '33.50';
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly policyDigest: string;
  readonly role: CoordinatorDeploymentRoleV33_48;
  readonly ordinal: number;
  readonly replacedActorDigest: string;
  readonly replacementActorDigest: string;
  readonly reasonCode: 'CHANNEL_EXPIRED' | 'ROLE_HOLDER_UNAVAILABLE' | 'KEY_REVOKED';
  readonly approvedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly approvalDigest: string;
}

export interface RoleReplacementCertificatePayloadV33_50 {
  readonly version: '33.50';
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly policyDigest: string;
  readonly role: CoordinatorDeploymentRoleV33_48;
  readonly ordinal: number;
  readonly replacedActor: CeremonyActorV33_49;
  readonly replacementActor: CeremonyActorV33_49;
  readonly approvalDigests: readonly string[];
  readonly reasonCode: RoleReplacementApprovalPayloadV33_50['reasonCode'];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly certificateDigest: string;
}

export interface IntakeReadinessVerdictPayloadV33_50 {
  readonly version: '33.50';
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly policyDigest: string;
  readonly baseCeremonyReceiptDigest: string;
  readonly roleReceiptDigests: readonly string[];
  readonly replacementCertificateDigests: readonly string[];
  readonly roleCount: 16;
  readonly externalAttestationCount: number;
  readonly externallyQualifiedScanCount: number;
  readonly allRolesQuarantinedAndVerified: true;
  readonly mutualAuthenticationVerified: true;
  readonly replacementChainVerified: true;
  readonly status: IntakeReadinessStatusV33_50;
  readonly externalCeremonyObserved: boolean;
  readonly externalHumanParticipants: 0;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly decidedAt: string;
  readonly verdictDigest: string;
}

export interface CeremonyEvidenceIntakeTrustV33_50 {
  readonly policyRegistry: KeyRegistry;
  readonly trustedPolicySignerIds: readonly string[];
  readonly portalRegistry: KeyRegistry;
  readonly trustedPortalSignerIds: readonly string[];
  readonly roleRegistry: KeyRegistry;
  readonly trustedRoleSignerIds: readonly string[];
  readonly scannerRegistry: KeyRegistry;
  readonly trustedScannerSignerIds: readonly string[];
  readonly replacementCustodianRegistry: KeyRegistry;
  readonly trustedReplacementCustodianIds: readonly string[];
  readonly replacementAuthorityRegistry: KeyRegistry;
  readonly trustedReplacementAuthorityIds: readonly string[];
  readonly readinessRegistry: KeyRegistry;
  readonly trustedReadinessSignerIds: readonly string[];
  readonly trustedExternalAttestationDigests: readonly string[];
  readonly trustedExternalScannerAttestationDigests: readonly string[];
}

const EXPECTED_ROLE_COUNTS: Readonly<Record<CoordinatorDeploymentRoleV33_48, number>> = {
  COORDINATOR_HOST: 4,
  CLOCK_ROOT: 2,
  APPEND_ONLY_STORE: 3,
  PARTITION_OBSERVER: 2,
  TOPOLOGY_AUDITOR: 2,
  EVIDENCE_EXPORTER: 1,
  EVIDENCE_IMPORTER: 1,
  RECOVERY_VERIFIER: 1,
};
const INFRASTRUCTURE_ROLES = new Set<CoordinatorDeploymentRoleV33_48>(['COORDINATOR_HOST','CLOCK_ROOT','APPEND_ONLY_STORE','PARTITION_OBSERVER']);
const digestWithout = <T extends Record<string, unknown>>(payload: T, key: keyof T) => { const m = { ...payload }; delete m[key]; return sha256(m); };
const assertDigest = (payload: Record<string, unknown>, key: string, code: string) => { const v=payload[key]; if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v)||digestWithout(payload,key)!==v) throw new Error(code); };
const timestamp = (value:string,code:string) => { const n=Date.parse(value); if(!Number.isFinite(n)) throw new Error(code); return n; };
const verify = <T>(e:SignedEnvelope<T>, registry:KeyRegistry, ids:readonly string[], at:Date, code:string) => { if(!ids.includes(e.issuerKeyId)||!registry.verifyAt(e,at)) throw new Error(code); };
const actorDigest = (actor:CeremonyActorV33_49) => sha256(actor);
const actorKey = (actor:CeremonyActorV33_49) => `${actor.keyId}|${actor.keyFingerprint}|${actor.organizationId}|${actor.hostId}|${actor.administratorId}`;
const safePath = (p:string) => p!==''&&!p.startsWith('/')&&!p.includes('\\')&&p.split('/').every(x=>x!==''&&x!=='.'&&x!=='..');
const assertActor = (a:CeremonyActorV33_49, code:string) => { if(Object.values(a).some(v=>typeof v!=='string'||v.trim()==='')) throw new Error(code); };
const assertSeparated = (actors:readonly CeremonyActorV33_49[], code:string) => { for(const k of ['keyId','keyFingerprint','hostId','administratorId'] as const) if(new Set(actors.map(a=>a[k])).size!==actors.length) throw new Error(code); };

export function createIntakePortalPolicyV33_50(input:{ signer:SigningIdentity; authority:CeremonyActorV33_49; portalId:string; ceremonyReceipt:CeremonyExecutionReceiptV33_49; authorizedEnrollmentResponses:readonly SignedEnvelope<CeremonyEnrollmentResponsePayloadV33_49>[]; issuedAt:Date; expiresAt:Date; }) {
  assertActor(input.authority,'intake_policy_actor');
  if(input.portalId.trim()===''||input.expiresAt<=input.issuedAt||input.ceremonyReceipt.status!=='LOCAL_EXTERNAL_CEREMONY_EXECUTION_REHEARSAL_ONLY'&&input.ceremonyReceipt.status!=='EXTERNAL_CEREMONY_EVIDENCE_READY_FOR_IMPORT') throw new Error('intake_policy_input');
  if(input.authorizedEnrollmentResponses.length!==16||new Set(input.authorizedEnrollmentResponses.map(r=>r.payload.responseDigest)).size!==16||input.authorizedEnrollmentResponses.some(r=>r.payload.ceremonyId!==input.ceremonyReceipt.ceremonyId))throw new Error('intake_policy_roster');
  const authorizedEnrollmentResponseDigests=input.authorizedEnrollmentResponses.map(r=>r.payload.responseDigest).sort();
  const m={version:'33.50' as const,portalId:input.portalId,ceremonyId:input.ceremonyReceipt.ceremonyId,baseCeremonyReceiptDigest:input.ceremonyReceipt.receiptDigest,authority:input.authority,authorizedEnrollmentResponseDigests,requiredRoleCount:16 as const,requiredExternalInfrastructureAttestations:22 as const,replacementApprovalQuorum:3 as const,channelTtlSeconds:1800,maximumFilesPerRole:16,maximumBytesPerRole:8*1024*1024,issuedAt:input.issuedAt.toISOString(),expiresAt:input.expiresAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,policyDigest:sha256(m)},input.signer);
}

export function issueMutualAuthChannelV33_50(input:{ portalSigner:SigningIdentity; portalActor:CeremonyActorV33_49; policy:SignedEnvelope<IntakePortalPolicyPayloadV33_50>; role:CoordinatorDeploymentRoleV33_48; ordinal:number; roleActor:CeremonyActorV33_49; transportSignerKeyId:string; clientCertificateFingerprint:string; serverCertificateFingerprint:string; tlsExporterBinding:Uint8Array; nonce:Uint8Array; issuedAt:Date; expiresAt:Date; }) {
  assertActor(input.portalActor,'channel_portal_actor'); assertActor(input.roleActor,'channel_role_actor');
  if(input.ordinal<1||input.transportSignerKeyId.trim()===''||input.tlsExporterBinding.byteLength<32||input.nonce.byteLength<32||input.expiresAt<=input.issuedAt||input.expiresAt.getTime()-input.issuedAt.getTime()>input.policy.payload.channelTtlSeconds*1000) throw new Error('channel_input');
  if(!/^[0-9a-f]{64}$/.test(input.clientCertificateFingerprint)||!/^[0-9a-f]{64}$/.test(input.serverCertificateFingerprint)||input.clientCertificateFingerprint===input.serverCertificateFingerprint) throw new Error('channel_certificate_binding');
  const m={version:'33.50' as const,portalId:input.policy.payload.portalId,ceremonyId:input.policy.payload.ceremonyId,policyDigest:input.policy.payload.policyDigest,role:input.role,ordinal:input.ordinal,roleActor:input.roleActor,transportSignerKeyId:input.transportSignerKeyId,portalActor:input.portalActor,clientCertificateFingerprint:input.clientCertificateFingerprint,serverCertificateFingerprint:input.serverCertificateFingerprint,tlsExporterBindingDigest:sha256Bytes(input.tlsExporterBinding),nonceDigest:sha256Bytes(input.nonce),issuedAt:input.issuedAt.toISOString(),expiresAt:input.expiresAt.toISOString(),oneSubmissionOnly:true as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,channelDigest:sha256(m)},input.portalSigner);
}

export function createRoleEvidenceSubmissionV33_50(input:{ roleSigner:SigningIdentity; actor:CeremonyActorV33_49; policy:SignedEnvelope<IntakePortalPolicyPayloadV33_50>; channel:SignedEnvelope<MutualAuthChannelPayloadV33_50>; enrollmentResponse:SignedEnvelope<CeremonyEnrollmentResponsePayloadV33_49>; executionClass:IntakeExecutionClassV33_50; files:readonly IntakeArtifactRecordV33_50[]; externalAttestationDigests?:readonly string[]; submittedAt:Date; }) {
  if(input.files.length<1||input.files.length>input.policy.payload.maximumFilesPerRole) throw new Error('submission_file_count');
  const total=input.files.reduce((s,f)=>s+f.byteLength,0); if(total>input.policy.payload.maximumBytesPerRole) throw new Error('submission_size');
  for(const f of input.files) if(!safePath(f.path)||f.byteLength<0||!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error('submission_file_invalid');
  if(new Set(input.files.map(f=>f.path)).size!==input.files.length) throw new Error('submission_duplicate_path');
  const external=[...(input.externalAttestationDigests??[])].sort(); if(external.some(x=>!/^[0-9a-f]{64}$/.test(x))||new Set(external).size!==external.length) throw new Error('submission_attestation_invalid');
  const m={version:'33.50' as const,portalId:input.policy.payload.portalId,ceremonyId:input.policy.payload.ceremonyId,policyDigest:input.policy.payload.policyDigest,channelDigest:input.channel.payload.channelDigest,enrollmentResponseDigest:input.enrollmentResponse.payload.responseDigest,role:input.channel.payload.role,ordinal:input.channel.payload.ordinal,actor:input.actor,executionClass:input.executionClass,files:[...input.files].sort((a,b)=>a.path.localeCompare(b.path)),externalAttestationDigests:external,submittedAt:input.submittedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,submissionDigest:sha256(m)},input.roleSigner);
}

function detectFile(path:string,mediaType:IntakeArtifactRecordV33_50['mediaType'],bytes:Uint8Array):IntakeScanFindingV33_50[] {
  const out:IntakeScanFindingV33_50[]=[]; const b=Buffer.from(bytes); const text=b.toString('utf8');
  const add=(ruleId:IntakeScanFindingV33_50['ruleId'],detail:string)=>out.push({path,ruleId,detailDigest:sha256({path,ruleId,detail})});
  if(text.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) add('EICAR','eicar-test-pattern');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) add('PRIVATE_KEY','pem-private-key');
  if((b[0]===0x7f&&b[1]===0x45&&b[2]===0x4c&&b[3]===0x46)||(b[0]===0x4d&&b[1]===0x5a)) add('EXECUTABLE_MAGIC','executable-header');
  if(text.startsWith('#!')||/<script\b/i.test(text)) add('ACTIVE_SCRIPT','active-content');
  if(mediaType==='application/json'){try{JSON.parse(text);}catch{add('MEDIA_TYPE_MISMATCH','invalid-json');}}
  return out;
}

export function createIntakeMalwareScanV33_50(input:{ scannerSigner:SigningIdentity; scannerActor:CeremonyActorV33_49; policy:SignedEnvelope<IntakePortalPolicyPayloadV33_50>; submission:SignedEnvelope<RoleEvidenceSubmissionPayloadV33_50>; fileBytes:Readonly<Record<string,Uint8Array>>; scannerEngine:'BUILTIN_STATIC_V33_50'|'EXTERNAL_QUALIFIED_SCANNER'; externalScannerAttestationDigest?:string|null; scannedAt:Date; }) {
  assertActor(input.scannerActor,'scan_actor'); const names=Object.keys(input.fileBytes).sort(); const expected=input.submission.payload.files.map(f=>f.path).sort(); if(JSON.stringify(names)!==JSON.stringify(expected)) throw new Error('scan_inventory');
  const findings:IntakeScanFindingV33_50[]=[]; let scannedBytes=0;
  for(const f of input.submission.payload.files){const bytes=input.fileBytes[f.path];if(!bytes||bytes.byteLength!==f.byteLength||sha256Bytes(bytes)!==f.sha256)throw new Error('scan_file_digest');scannedBytes+=bytes.byteLength;findings.push(...detectFile(f.path,f.mediaType,bytes));}
  const external=input.externalScannerAttestationDigest??null;
  if(input.scannerEngine==='EXTERNAL_QUALIFIED_SCANNER'&&(!external||!input.externalScannerAttestationDigest||!/^[0-9a-f]{64}$/.test(external))) throw new Error('scan_external_attestation');
  if(input.scannerEngine==='BUILTIN_STATIC_V33_50'&&external!==null) throw new Error('scan_builtin_attestation');
  const status:IntakeScanStatusV33_50=findings.length>0?'REJECTED':input.scannerEngine==='EXTERNAL_QUALIFIED_SCANNER'?'EXTERNAL_QUALIFIED_CLEAN':'BUILTIN_CLEAN_QUARANTINED';
  const m={version:'33.50' as const,portalId:input.policy.payload.portalId,ceremonyId:input.policy.payload.ceremonyId,submissionDigest:input.submission.payload.submissionDigest,scannerActor:input.scannerActor,scannerEngine:input.scannerEngine,externalScannerAttestationDigest:external,findings,scannedFileCount:input.submission.payload.files.length,scannedBytes,status,scannedAt:input.scannedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,scanDigest:sha256(m)},input.scannerSigner);
}

export function createRoleReplacementApprovalV33_50(input:{ custodian:SigningIdentity; policy:SignedEnvelope<IntakePortalPolicyPayloadV33_50>; role:CoordinatorDeploymentRoleV33_48; ordinal:number; replacedActor:CeremonyActorV33_49; replacementActor:CeremonyActorV33_49; reasonCode:RoleReplacementApprovalPayloadV33_50['reasonCode']; approvedAt:Date; }) {
  if(actorKey(input.replacedActor)===actorKey(input.replacementActor)||input.ordinal<1) throw new Error('replacement_approval_input');
  const m={version:'33.50' as const,portalId:input.policy.payload.portalId,ceremonyId:input.policy.payload.ceremonyId,policyDigest:input.policy.payload.policyDigest,role:input.role,ordinal:input.ordinal,replacedActorDigest:actorDigest(input.replacedActor),replacementActorDigest:actorDigest(input.replacementActor),reasonCode:input.reasonCode,approvedAt:input.approvedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,approvalDigest:sha256(m)},input.custodian);
}

export function createRoleReplacementCertificateV33_50(input:{ authority:SigningIdentity; policy:SignedEnvelope<IntakePortalPolicyPayloadV33_50>; role:CoordinatorDeploymentRoleV33_48; ordinal:number; replacedActor:CeremonyActorV33_49; replacementActor:CeremonyActorV33_49; approvals:readonly SignedEnvelope<RoleReplacementApprovalPayloadV33_50>[]; reasonCode:RoleReplacementApprovalPayloadV33_50['reasonCode']; issuedAt:Date; expiresAt:Date; trust:CeremonyEvidenceIntakeTrustV33_50; }) {
  if(input.approvals.length!==input.policy.payload.replacementApprovalQuorum||input.expiresAt<=input.issuedAt) throw new Error('replacement_quorum');
  const issuers=new Set<string>();
  for(const a of input.approvals){verify(a,input.trust.replacementCustodianRegistry,input.trust.trustedReplacementCustodianIds,input.issuedAt,'replacement_approval_signature');assertDigest(a.payload as unknown as Record<string,unknown>,'approvalDigest','replacement_approval_digest');if(a.payload.policyDigest!==input.policy.payload.policyDigest||a.payload.role!==input.role||a.payload.ordinal!==input.ordinal||a.payload.replacedActorDigest!==actorDigest(input.replacedActor)||a.payload.replacementActorDigest!==actorDigest(input.replacementActor)||a.payload.reasonCode!==input.reasonCode)throw new Error('replacement_approval_binding');if(issuers.has(a.issuerKeyId))throw new Error('replacement_duplicate_issuer');issuers.add(a.issuerKeyId);}
  assertSeparated([input.replacedActor,input.replacementActor],'replacement_actor_separation');
  const m={version:'33.50' as const,portalId:input.policy.payload.portalId,ceremonyId:input.policy.payload.ceremonyId,policyDigest:input.policy.payload.policyDigest,role:input.role,ordinal:input.ordinal,replacedActor:input.replacedActor,replacementActor:input.replacementActor,approvalDigests:input.approvals.map(a=>a.payload.approvalDigest).sort(),reasonCode:input.reasonCode,issuedAt:input.issuedAt.toISOString(),expiresAt:input.expiresAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,certificateDigest:sha256(m)},input.authority);
}

export class CeremonyEvidenceIntakePortalV33_50 {
  readonly #receipts=new Map<string,SignedEnvelope<QuarantineReceiptPayloadV33_50>>();
  readonly #consumedChannels=new Map<string,string>();
  constructor(readonly trust:CeremonyEvidenceIntakeTrustV33_50,readonly portalSigner:SigningIdentity,readonly readinessSigner:SigningIdentity){}
  intake(input:{ policy:SignedEnvelope<IntakePortalPolicyPayloadV33_50>; ceremonyReceipt:CeremonyExecutionReceiptV33_49; channel:SignedEnvelope<MutualAuthChannelPayloadV33_50>; enrollmentResponse:SignedEnvelope<CeremonyEnrollmentResponsePayloadV33_49>; submission:SignedEnvelope<RoleEvidenceSubmissionPayloadV33_50>; scan:SignedEnvelope<IntakeMalwareScanPayloadV33_50>; fileBytes:Readonly<Record<string,Uint8Array>>; acceptedAt:Date; replacementCertificate?:SignedEnvelope<RoleReplacementCertificatePayloadV33_50>; }):SignedEnvelope<QuarantineReceiptPayloadV33_50>{
    const at=input.acceptedAt; verify(input.policy,this.trust.policyRegistry,this.trust.trustedPolicySignerIds,at,'policy_signature'); assertDigest(input.policy.payload as unknown as Record<string,unknown>,'policyDigest','policy_digest');
    if(input.policy.payload.baseCeremonyReceiptDigest!==input.ceremonyReceipt.receiptDigest||input.policy.payload.ceremonyId!==input.ceremonyReceipt.ceremonyId)throw new Error('policy_base_binding');
    if(timestamp(input.policy.payload.issuedAt,'policy_time')>at.getTime()||timestamp(input.policy.payload.expiresAt,'policy_time')<at.getTime())throw new Error('policy_expired');
    verify(input.channel,this.trust.portalRegistry,this.trust.trustedPortalSignerIds,at,'channel_signature'); assertDigest(input.channel.payload as unknown as Record<string,unknown>,'channelDigest','channel_digest');
    if(input.channel.payload.policyDigest!==input.policy.payload.policyDigest||input.channel.payload.ceremonyId!==input.policy.payload.ceremonyId||timestamp(input.channel.payload.issuedAt,'channel_time')>at.getTime()||timestamp(input.channel.payload.expiresAt,'channel_time')<at.getTime())throw new Error('channel_binding');
    verify(input.submission,this.trust.roleRegistry,this.trust.trustedRoleSignerIds,at,'submission_signature'); assertDigest(input.submission.payload as unknown as Record<string,unknown>,'submissionDigest','submission_digest');
    if(input.submission.issuerKeyId!==input.channel.payload.transportSignerKeyId||input.submission.payload.channelDigest!==input.channel.payload.channelDigest||input.submission.payload.policyDigest!==input.policy.payload.policyDigest||input.submission.payload.role!==input.channel.payload.role||input.submission.payload.ordinal!==input.channel.payload.ordinal||actorKey(input.submission.payload.actor)!==actorKey(input.channel.payload.roleActor))throw new Error('submission_binding');
    verify(input.enrollmentResponse,this.trust.roleRegistry,this.trust.trustedRoleSignerIds,at,'enrollment_response_signature'); assertDigest(input.enrollmentResponse.payload as unknown as Record<string,unknown>,'responseDigest','enrollment_response_digest');
    if(!input.policy.payload.authorizedEnrollmentResponseDigests.includes(input.enrollmentResponse.payload.responseDigest))throw new Error('enrollment_response_unauthorized');
    if(input.enrollmentResponse.payload.responseDigest!==input.submission.payload.enrollmentResponseDigest||input.enrollmentResponse.payload.role!==input.submission.payload.role||input.enrollmentResponse.payload.ordinal!==input.submission.payload.ordinal)throw new Error('enrollment_response_binding');
    if(actorKey(input.enrollmentResponse.payload.actor)!==actorKey(input.submission.payload.actor)){
      const c=input.replacementCertificate;if(!c)throw new Error('replacement_required');verify(c,this.trust.replacementAuthorityRegistry,this.trust.trustedReplacementAuthorityIds,at,'replacement_certificate_signature');assertDigest(c.payload as unknown as Record<string,unknown>,'certificateDigest','replacement_certificate_digest');if(c.payload.policyDigest!==input.policy.payload.policyDigest||c.payload.role!==input.submission.payload.role||c.payload.ordinal!==input.submission.payload.ordinal||actorKey(c.payload.replacedActor)!==actorKey(input.enrollmentResponse.payload.actor)||actorKey(c.payload.replacementActor)!==actorKey(input.submission.payload.actor)||timestamp(c.payload.expiresAt,'replacement_time')<at.getTime())throw new Error('replacement_certificate_binding');
    }
    verify(input.scan,this.trust.scannerRegistry,this.trust.trustedScannerSignerIds,at,'scan_signature');assertDigest(input.scan.payload as unknown as Record<string,unknown>,'scanDigest','scan_digest');if(input.scan.payload.submissionDigest!==input.submission.payload.submissionDigest||input.scan.payload.status==='REJECTED')throw new Error('scan_rejected');
    if(input.scan.payload.scannerEngine==='EXTERNAL_QUALIFIED_SCANNER'&&!this.trust.trustedExternalScannerAttestationDigests.includes(input.scan.payload.externalScannerAttestationDigest??''))throw new Error('external_scanner_untrusted');
    const expected=input.submission.payload.files.map(f=>f.path).sort();if(JSON.stringify(Object.keys(input.fileBytes).sort())!==JSON.stringify(expected))throw new Error('intake_inventory');for(const f of input.submission.payload.files){const b=input.fileBytes[f.path];if(!b||b.byteLength!==f.byteLength||sha256Bytes(b)!==f.sha256)throw new Error('intake_file_digest');}
    if(input.submission.payload.executionClass==='LIVE_EXTERNAL'){
      if(input.scan.payload.status!=='EXTERNAL_QUALIFIED_CLEAN')throw new Error('external_scan_required');
      if(input.submission.payload.externalAttestationDigests.some(d=>!this.trust.trustedExternalAttestationDigests.includes(d)))throw new Error('external_attestation_untrusted');
    } else if(input.submission.payload.externalAttestationDigests.length!==0) throw new Error('local_external_attestation');
    const roleSlot=`${input.submission.payload.role}:${input.submission.payload.ordinal}`;const existing=this.#receipts.get(roleSlot);if(existing){if(existing.payload.submissionDigest===input.submission.payload.submissionDigest)return existing;throw new Error('role_slot_conflict');}
    const used=this.#consumedChannels.get(input.channel.payload.channelDigest);if(used&&used!==input.submission.payload.submissionDigest)throw new Error('channel_replay');this.#consumedChannels.set(input.channel.payload.channelDigest,input.submission.payload.submissionDigest);
    const eligible=input.submission.payload.executionClass==='LIVE_EXTERNAL'&&input.scan.payload.status==='EXTERNAL_QUALIFIED_CLEAN';
    const m={version:'33.50' as const,portalId:input.policy.payload.portalId,ceremonyId:input.policy.payload.ceremonyId,policyDigest:input.policy.payload.policyDigest,role:input.submission.payload.role,ordinal:input.submission.payload.ordinal,actor:input.submission.payload.actor,channelDigest:input.channel.payload.channelDigest,submissionDigest:input.submission.payload.submissionDigest,scanDigest:input.scan.payload.scanDigest,executionClass:input.submission.payload.executionClass,externalAttestationDigests:input.submission.payload.externalAttestationDigests,quarantineStatus:'SCAN_PASSED_QUARANTINED' as const,eligibleForLocalReadiness:true as const,eligibleForExternalReadiness:eligible,acceptedAt:at.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};const receipt=signEnvelope({...m,receiptDigest:sha256(m)},this.portalSigner);this.#receipts.set(roleSlot,receipt);return receipt;
  }
  receipts(){return [...this.#receipts.values()].sort((a,b)=>a.payload.role.localeCompare(b.payload.role)||a.payload.ordinal-b.payload.ordinal);}
  decideReadiness(input:{ policy:SignedEnvelope<IntakePortalPolicyPayloadV33_50>; ceremonyReceipt:CeremonyExecutionReceiptV33_49; replacementCertificates?:readonly SignedEnvelope<RoleReplacementCertificatePayloadV33_50>[]; decidedAt:Date; }):SignedEnvelope<IntakeReadinessVerdictPayloadV33_50>{
    verify(input.policy,this.trust.policyRegistry,this.trust.trustedPolicySignerIds,input.decidedAt,'policy_signature');const receipts=this.receipts();if(receipts.length!==16)throw new Error('readiness_role_count');
    const counts=new Map<CoordinatorDeploymentRoleV33_48,number>();for(const r of receipts){counts.set(r.payload.role,(counts.get(r.payload.role)??0)+1);verify(r,this.trust.portalRegistry,this.trust.trustedPortalSignerIds,input.decidedAt,'receipt_signature');assertDigest(r.payload as unknown as Record<string,unknown>,'receiptDigest','receipt_digest');}
    for(const [role,count] of Object.entries(EXPECTED_ROLE_COUNTS) as [CoordinatorDeploymentRoleV33_48,number][])if(counts.get(role)!==count)throw new Error('readiness_role_cardinality');
    const actors=receipts.map(r=>r.payload.actor);assertSeparated(actors,'readiness_actor_separation');
    const externalAttestations=[...new Set(receipts.flatMap(r=>r.payload.externalAttestationDigests))].sort();const externallyQualifiedScanCount=receipts.filter(r=>r.payload.eligibleForExternalReadiness).length;const allExternal=receipts.every(r=>r.payload.executionClass==='LIVE_EXTERNAL'&&r.payload.eligibleForExternalReadiness);
    const infrastructureAttestationCount=receipts.filter(r=>INFRASTRUCTURE_ROLES.has(r.payload.role)).reduce((s,r)=>s+r.payload.externalAttestationDigests.length,0);
    const externalReady=allExternal&&externallyQualifiedScanCount===16&&infrastructureAttestationCount===22&&externalAttestations.length===22&&externalAttestations.every(d=>this.trust.trustedExternalAttestationDigests.includes(d));
    const replacements=input.replacementCertificates??[];for(const c of replacements){verify(c,this.trust.replacementAuthorityRegistry,this.trust.trustedReplacementAuthorityIds,input.decidedAt,'replacement_certificate_signature');assertDigest(c.payload as unknown as Record<string,unknown>,'certificateDigest','replacement_certificate_digest');}
    const status:IntakeReadinessStatusV33_50=externalReady?'EXTERNAL_CEREMONY_EVIDENCE_READY_FOR_IMPORT':'LOCAL_CEREMONY_INTAKE_COMPLETE_REHEARSAL_ONLY';
    const m={version:'33.50' as const,portalId:input.policy.payload.portalId,ceremonyId:input.policy.payload.ceremonyId,policyDigest:input.policy.payload.policyDigest,baseCeremonyReceiptDigest:input.ceremonyReceipt.receiptDigest,roleReceiptDigests:receipts.map(r=>r.payload.receiptDigest).sort(),replacementCertificateDigests:replacements.map(r=>r.payload.certificateDigest).sort(),roleCount:16 as const,externalAttestationCount:externalAttestations.length,externallyQualifiedScanCount,allRolesQuarantinedAndVerified:true as const,mutualAuthenticationVerified:true as const,replacementChainVerified:true as const,status,externalCeremonyObserved:externalReady,externalHumanParticipants:0 as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const,decidedAt:input.decidedAt.toISOString()};return signEnvelope({...m,verdictDigest:sha256(m)},this.readinessSigner);
  }
}

export function verifyIntakeReadinessVerdictV33_50(input:{ verdict:SignedEnvelope<IntakeReadinessVerdictPayloadV33_50>; policy:SignedEnvelope<IntakePortalPolicyPayloadV33_50>; ceremonyReceipt:CeremonyExecutionReceiptV33_49; receipts:readonly SignedEnvelope<QuarantineReceiptPayloadV33_50>[]; replacementCertificates?:readonly SignedEnvelope<RoleReplacementCertificatePayloadV33_50>[]; trust:CeremonyEvidenceIntakeTrustV33_50; verifiedAt:Date; }):IntakeReadinessVerdictPayloadV33_50 {
  verify(input.verdict,input.trust.readinessRegistry,input.trust.trustedReadinessSignerIds,input.verifiedAt,'readiness_signature');assertDigest(input.verdict.payload as unknown as Record<string,unknown>,'verdictDigest','readiness_digest');
  if(input.verdict.payload.policyDigest!==input.policy.payload.policyDigest||input.verdict.payload.baseCeremonyReceiptDigest!==input.ceremonyReceipt.receiptDigest||input.verdict.payload.roleCount!==16||input.verdict.payload.productionAuthority!=='NONE'||input.verdict.payload.externalEffectsExecuted!==0||input.verdict.payload.externalHumanParticipants!==0)throw new Error('readiness_binding');
  const expected=input.receipts.map(r=>r.payload.receiptDigest).sort();if(JSON.stringify(expected)!==JSON.stringify(input.verdict.payload.roleReceiptDigests))throw new Error('readiness_receipts');
  const replacements=(input.replacementCertificates??[]).map(r=>r.payload.certificateDigest).sort();if(JSON.stringify(replacements)!==JSON.stringify(input.verdict.payload.replacementCertificateDigests))throw new Error('readiness_replacements');
  const ext=[...new Set(input.receipts.flatMap(r=>r.payload.externalAttestationDigests))];const qualified=input.receipts.filter(r=>r.payload.eligibleForExternalReadiness).length;const infrastructure=input.receipts.filter(r=>INFRASTRUCTURE_ROLES.has(r.payload.role)).reduce((s,r)=>s+r.payload.externalAttestationDigests.length,0);
  const externalReady=input.receipts.length===16&&input.receipts.every(r=>r.payload.executionClass==='LIVE_EXTERNAL'&&r.payload.eligibleForExternalReadiness)&&qualified===16&&ext.length===22&&infrastructure===22&&ext.every(d=>input.trust.trustedExternalAttestationDigests.includes(d));
  const expectedStatus=externalReady?'EXTERNAL_CEREMONY_EVIDENCE_READY_FOR_IMPORT':'LOCAL_CEREMONY_INTAKE_COMPLETE_REHEARSAL_ONLY';if(input.verdict.payload.status!==expectedStatus||input.verdict.payload.externalCeremonyObserved!==externalReady||input.verdict.payload.externalAttestationCount!==ext.length||input.verdict.payload.externallyQualifiedScanCount!==qualified)throw new Error('readiness_recompute');
  return input.verdict.payload;
}

export function verifyRoleReplacementCertificateV33_50(input:{ policy:SignedEnvelope<IntakePortalPolicyPayloadV33_50>; certificate:SignedEnvelope<RoleReplacementCertificatePayloadV33_50>; approvals:readonly SignedEnvelope<RoleReplacementApprovalPayloadV33_50>[]; trust:CeremonyEvidenceIntakeTrustV33_50; verifiedAt:Date; }):RoleReplacementCertificatePayloadV33_50 {
  verify(input.certificate,input.trust.replacementAuthorityRegistry,input.trust.trustedReplacementAuthorityIds,input.verifiedAt,'replacement_certificate_signature');assertDigest(input.certificate.payload as unknown as Record<string,unknown>,'certificateDigest','replacement_certificate_digest');
  if(input.approvals.length!==input.policy.payload.replacementApprovalQuorum||input.certificate.payload.policyDigest!==input.policy.payload.policyDigest||timestamp(input.certificate.payload.issuedAt,'replacement_time')>input.verifiedAt.getTime()||timestamp(input.certificate.payload.expiresAt,'replacement_time')<input.verifiedAt.getTime())throw new Error('replacement_certificate_binding');
  const issuers=new Set<string>();const digests:string[]=[];
  for(const approval of input.approvals){verify(approval,input.trust.replacementCustodianRegistry,input.trust.trustedReplacementCustodianIds,input.verifiedAt,'replacement_approval_signature');assertDigest(approval.payload as unknown as Record<string,unknown>,'approvalDigest','replacement_approval_digest');if(approval.payload.policyDigest!==input.policy.payload.policyDigest||approval.payload.role!==input.certificate.payload.role||approval.payload.ordinal!==input.certificate.payload.ordinal||approval.payload.replacedActorDigest!==actorDigest(input.certificate.payload.replacedActor)||approval.payload.replacementActorDigest!==actorDigest(input.certificate.payload.replacementActor)||approval.payload.reasonCode!==input.certificate.payload.reasonCode)throw new Error('replacement_approval_binding');if(issuers.has(approval.issuerKeyId))throw new Error('replacement_duplicate_issuer');issuers.add(approval.issuerKeyId);digests.push(approval.payload.approvalDigest);}
  if(JSON.stringify(digests.sort())!==JSON.stringify([...input.certificate.payload.approvalDigests].sort()))throw new Error('replacement_approval_set');assertSeparated([input.certificate.payload.replacedActor,input.certificate.payload.replacementActor],'replacement_actor_separation');return input.certificate.payload;
}
