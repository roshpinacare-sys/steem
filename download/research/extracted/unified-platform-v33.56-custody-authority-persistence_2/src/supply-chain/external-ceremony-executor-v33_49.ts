import { KeyRegistry, sha256, sha256Bytes, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type {
  CoordinatorDeploymentActorV33_48,
  CoordinatorDeploymentRoleV33_48,
  CoordinatorExternalEvidenceImportReceiptV33_48,
} from './external-coordinator-deployment-evidence-import-v33_48.js';

export type CeremonyExecutionClassV33_49 = 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
export type CeremonyStatusV33_49 = 'OPEN' | 'COMPLETED' | 'REVOKED' | 'EXPIRED';

export interface CeremonyActorV33_49 extends CoordinatorDeploymentActorV33_48 {}
export interface CeremonyPolicyPayloadV33_49 {
  readonly version: '33.49'; readonly ceremonyId: string; readonly manifestDigest: string;
  readonly baseImportReceiptDigest: string; readonly authority: CeremonyActorV33_49;
  readonly enrollmentPackageTtlSeconds: number; readonly responseTtlSeconds: number;
  readonly requiredRoleCount: 16; readonly requiredExternalInfrastructureAttestations: 22;
  readonly interruptionRevocationQuorum: 3; readonly issuedAt: string; readonly expiresAt: string;
  readonly productionAuthority: 'NONE'; readonly externalEffectsExecuted: 0; readonly policyDigest: string;
}
export interface CeremonyEnrollmentPackagePayloadV33_49 {
  readonly version: '33.49'; readonly ceremonyId: string; readonly policyDigest: string;
  readonly manifestDigest: string; readonly role: CoordinatorDeploymentRoleV33_48; readonly ordinal: number;
  readonly actor: CeremonyActorV33_49; readonly nonceDigest: string; readonly issuedAt: string; readonly expiresAt: string;
  readonly productionAuthority: 'NONE'; readonly externalEffectsExecuted: 0; readonly packageDigest: string;
}
export interface CeremonyEnrollmentResponsePayloadV33_49 {
  readonly version: '33.49'; readonly ceremonyId: string; readonly packageDigest: string;
  readonly role: CoordinatorDeploymentRoleV33_48; readonly ordinal: number; readonly actor: CeremonyActorV33_49;
  readonly possessionChallengeDigest: string; readonly executionClass: CeremonyExecutionClassV33_49;
  readonly externalAttestationDigest: string | null; readonly respondedAt: string;
  readonly productionAuthority: 'NONE'; readonly externalEffectsExecuted: 0; readonly responseDigest: string;
}
export interface CeremonyExternalAttestationPayloadV33_49 {
  readonly version: '33.49'; readonly ceremonyId: string; readonly responseDigest: string;
  readonly subject: CeremonyActorV33_49; readonly auditor: CeremonyActorV33_49;
  readonly providerEvidenceDigest: string; readonly observedAt: string;
  readonly productionAuthority: 'NONE'; readonly externalEffectsExecuted: 0; readonly attestationDigest: string;
}
export interface CeremonyTranscriptPayloadV33_49 {
  readonly version: '33.49'; readonly ceremonyId: string; readonly policyDigest: string; readonly manifestDigest: string;
  readonly baseImportReceiptDigest: string; readonly executionClass: CeremonyExecutionClassV33_49;
  readonly responseDigests: readonly string[]; readonly externalAttestationDigests: readonly string[];
  readonly evidenceExporterKeyId: string; readonly evidenceImporterKeyId: string;
  readonly openedAt: string; readonly closedAt: string; readonly roleCount: 16;
  readonly externalInfrastructureAttestationCount: number; readonly status: 'COMPLETED';
  readonly productionAuthority: 'NONE'; readonly externalEffectsExecuted: 0; readonly transcriptDigest: string;
}
export interface CeremonyTransferChallengePayloadV33_49 {
  readonly version: '33.49'; readonly ceremonyId: string; readonly transcriptDigest: string;
  readonly nonceDigest: string; readonly issuedAt: string; readonly expiresAt: string;
  readonly productionAuthority: 'NONE'; readonly externalEffectsExecuted: 0; readonly challengeDigest: string;
}
export interface CeremonyTransferFileV33_49 { readonly path: string; readonly byteLength: number; readonly sha256: string; readonly mediaType: string; }
export interface CeremonySealedTransferPayloadV33_49 {
  readonly version: '33.49'; readonly ceremonyId: string; readonly transcriptDigest: string; readonly challengeDigest: string;
  readonly files: readonly CeremonyTransferFileV33_49[]; readonly exportedAt: string;
  readonly productionAuthority: 'NONE'; readonly externalEffectsExecuted: 0; readonly transferDigest: string;
}
export interface CeremonyRevocationApprovalPayloadV33_49 {
  readonly version: '33.49'; readonly ceremonyId: string; readonly policyDigest: string; readonly reasonCode: string;
  readonly approvedAt: string; readonly productionAuthority: 'NONE'; readonly externalEffectsExecuted: 0; readonly approvalDigest: string;
}
export interface CeremonyRevocationCertificatePayloadV33_49 {
  readonly version: '33.49'; readonly ceremonyId: string; readonly policyDigest: string;
  readonly approvalDigests: readonly string[]; readonly reasonCode: string; readonly revokedAt: string;
  readonly productionAuthority: 'NONE'; readonly externalEffectsExecuted: 0; readonly revocationDigest: string;
}
export interface CeremonyExecutionTrustV33_49 {
  readonly authorityRegistry: KeyRegistry; readonly trustedAuthorityIds: readonly string[];
  readonly roleRegistry: KeyRegistry; readonly auditorRegistry: KeyRegistry; readonly trustedAuditorIds: readonly string[];
  readonly exporterRegistry: KeyRegistry; readonly trustedExporterIds: readonly string[];
  readonly importerRegistry: KeyRegistry; readonly trustedImporterIds: readonly string[];
  readonly revocationCustodianRegistry: KeyRegistry; readonly trustedRevocationCustodianIds: readonly string[];
  readonly revocationAuthorityRegistry: KeyRegistry; readonly trustedRevocationAuthorityIds: readonly string[];
  readonly trustedExternalEvidenceDigests: readonly string[];
}
export interface CeremonyExecutionReceiptV33_49 {
  readonly version: '33.49';
  readonly status: 'LOCAL_EXTERNAL_CEREMONY_EXECUTION_REHEARSAL_ONLY' | 'EXTERNAL_CEREMONY_EVIDENCE_READY_FOR_IMPORT';
  readonly ceremonyId: string; readonly policyDigest: string; readonly transcriptDigest: string; readonly transferDigest: string;
  readonly baseImportReceiptDigest: string; readonly roleCount: 16; readonly externalAttestationCount: number;
  readonly exactTransferInventoryVerified: true; readonly replayProtectionVerified: true;
  readonly externalCeremonyObserved: boolean; readonly externalHumanParticipants: 0;
  readonly productionAuthority: 'NONE'; readonly externalEffectsExecuted: 0; readonly importedAt: string; readonly receiptDigest: string;
}

const materialDigest = <T extends Record<string, unknown>>(payload: T, key: keyof T) => { const m = { ...payload }; delete m[key]; return sha256(m); };
const assertDigest = (payload: Record<string, unknown>, key: string, code: string) => { if (typeof payload[key] !== 'string' || !/^[0-9a-f]{64}$/.test(payload[key] as string) || materialDigest(payload, key) !== payload[key]) throw new Error(code); };
const time = (value: string, code: string) => { const n = Date.parse(value); if (!Number.isFinite(n)) throw new Error(code); return n; };
const verify = <T>(e: SignedEnvelope<T>, r: KeyRegistry, ids: readonly string[], at: Date, code: string) => { if (!ids.includes(e.issuerKeyId) || !r.verifyAt(e, at)) throw new Error(code); };
const actorId = (a: CeremonyActorV33_49) => `${a.keyId}|${a.keyFingerprint}|${a.organizationId}|${a.hostId}|${a.administratorId}`;
const distinct = (actors: readonly CeremonyActorV33_49[], code: string) => { for (const k of ['keyId','keyFingerprint','organizationId','hostId','administratorId'] as const) if (new Set(actors.map(a=>a[k])).size !== actors.length) throw new Error(code); };
const safePath = (p: string) => p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every(x => x !== '' && x !== '.' && x !== '..');

export function createCeremonyPolicyV33_49(input: { authority: SigningIdentity; authorityDescriptor: CeremonyActorV33_49; ceremonyId: string; manifestDigest: string; baseImportReceiptDigest: string; issuedAt: Date; expiresAt: Date; }) {
  if (input.ceremonyId.trim()==='' || !/^[0-9a-f]{64}$/.test(input.manifestDigest) || !/^[0-9a-f]{64}$/.test(input.baseImportReceiptDigest) || input.expiresAt <= input.issuedAt) throw new Error('ceremony_policy_input');
  const m = { version:'33.49' as const, ceremonyId:input.ceremonyId, manifestDigest:input.manifestDigest, baseImportReceiptDigest:input.baseImportReceiptDigest, authority:input.authorityDescriptor, enrollmentPackageTtlSeconds:3600, responseTtlSeconds:3600, requiredRoleCount:16 as const, requiredExternalInfrastructureAttestations:22 as const, interruptionRevocationQuorum:3 as const, issuedAt:input.issuedAt.toISOString(), expiresAt:input.expiresAt.toISOString(), productionAuthority:'NONE' as const, externalEffectsExecuted:0 as const };
  return signEnvelope({ ...m, policyDigest:sha256(m) }, input.authority);
}
export function createCeremonyEnrollmentPackageV33_49(input: { authority: SigningIdentity; policy: SignedEnvelope<CeremonyPolicyPayloadV33_49>; role: CoordinatorDeploymentRoleV33_48; ordinal:number; actor:CeremonyActorV33_49; nonce:Uint8Array; issuedAt:Date; expiresAt:Date; }) {
  if (input.ordinal<1 || input.nonce.byteLength<32 || input.expiresAt<=input.issuedAt || input.expiresAt.getTime()-input.issuedAt.getTime()>3600_000) throw new Error('ceremony_package_input');
  const m={version:'33.49' as const,ceremonyId:input.policy.payload.ceremonyId,policyDigest:input.policy.payload.policyDigest,manifestDigest:input.policy.payload.manifestDigest,role:input.role,ordinal:input.ordinal,actor:input.actor,nonceDigest:sha256Bytes(input.nonce),issuedAt:input.issuedAt.toISOString(),expiresAt:input.expiresAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,packageDigest:sha256(m)},input.authority);
}
export function createCeremonyEnrollmentResponseV33_49(input:{actor:SigningIdentity; actorDescriptor:CeremonyActorV33_49; enrollmentPackage:SignedEnvelope<CeremonyEnrollmentPackagePayloadV33_49>; possessionChallenge:Uint8Array; executionClass:CeremonyExecutionClassV33_49; externalAttestationDigest?:string|null; respondedAt:Date;}) {
  const p=input.enrollmentPackage.payload; if(input.actor.keyId!==p.actor.keyId || actorId(input.actorDescriptor)!==actorId(p.actor) || input.possessionChallenge.byteLength<32) throw new Error('ceremony_response_actor');
  const ext=input.externalAttestationDigest??null; if(input.executionClass==='LOCAL_REHEARSAL'&&ext!==null) throw new Error('ceremony_response_local_external_digest'); if(input.executionClass==='LIVE_EXTERNAL'&&(ext===null||!/^[0-9a-f]{64}$/.test(ext))) throw new Error('ceremony_response_external_digest');
  const m={version:'33.49' as const,ceremonyId:p.ceremonyId,packageDigest:p.packageDigest,role:p.role,ordinal:p.ordinal,actor:p.actor,possessionChallengeDigest:sha256Bytes(input.possessionChallenge),executionClass:input.executionClass,externalAttestationDigest:ext,respondedAt:input.respondedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,responseDigest:sha256(m)},input.actor);
}
export function createCeremonyExternalAttestationV33_49(input:{auditor:SigningIdentity; auditorDescriptor:CeremonyActorV33_49; response:SignedEnvelope<CeremonyEnrollmentResponsePayloadV33_49>; providerEvidenceDigest:string; observedAt:Date;}) {
  if(!/^[0-9a-f]{64}$/.test(input.providerEvidenceDigest)) throw new Error('ceremony_attestation_provider');
  const m={version:'33.49' as const,ceremonyId:input.response.payload.ceremonyId,responseDigest:input.response.payload.responseDigest,subject:input.response.payload.actor,auditor:input.auditorDescriptor,providerEvidenceDigest:input.providerEvidenceDigest,observedAt:input.observedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...m,attestationDigest:sha256(m)},input.auditor);
}
function buildCeremonyTranscriptPayloadV33_49(input:{baseImportReceipt:CoordinatorExternalEvidenceImportReceiptV33_48;policy:SignedEnvelope<CeremonyPolicyPayloadV33_49>;packages:readonly SignedEnvelope<CeremonyEnrollmentPackagePayloadV33_49>[];responses:readonly SignedEnvelope<CeremonyEnrollmentResponsePayloadV33_49>[];externalAttestations:readonly SignedEnvelope<CeremonyExternalAttestationPayloadV33_49>[];trust:CeremonyExecutionTrustV33_49;consumedPackageDigests:Set<string>;revokedPolicyDigests:Set<string>;closedAt:Date;}) {
  const at=input.closedAt; const p=input.policy.payload; verify(input.policy,input.trust.authorityRegistry,input.trust.trustedAuthorityIds,at,'ceremony_policy_signature'); assertDigest(p as unknown as Record<string,unknown>,'policyDigest','ceremony_policy_digest');
  if(input.revokedPolicyDigests.has(p.policyDigest)) throw new Error('ceremony_policy_revoked');
  if(p.baseImportReceiptDigest!==input.baseImportReceipt.receiptDigest || input.baseImportReceipt.version!=='33.48' || input.baseImportReceipt.productionAuthority!=='NONE' || input.baseImportReceipt.externalEffectsExecuted!==0) throw new Error('ceremony_base_receipt');
  if(at.getTime()>time(p.expiresAt,'ceremony_policy_expiry')) throw new Error('ceremony_policy_expired'); if(input.packages.length!==16||input.responses.length!==16) throw new Error('ceremony_role_cardinality');
  const packageByDigest=new Map<string,CeremonyEnrollmentPackagePayloadV33_49>(); const roleKeys=new Set<string>(); const actors:CeremonyActorV33_49[]=[];
  for(const e of input.packages){verify(e,input.trust.authorityRegistry,input.trust.trustedAuthorityIds,at,'ceremony_package_signature'); const x=e.payload; assertDigest(x as unknown as Record<string,unknown>,'packageDigest','ceremony_package_digest'); if(e.issuerKeyId!==input.policy.issuerKeyId||x.policyDigest!==p.policyDigest||x.manifestDigest!==p.manifestDigest||x.ceremonyId!==p.ceremonyId||at.getTime()>time(x.expiresAt,'ceremony_package_expired')||input.consumedPackageDigests.has(x.packageDigest)) throw new Error('ceremony_package_binding'); const rk=`${x.role}:${x.ordinal}`; if(roleKeys.has(rk)||packageByDigest.has(x.packageDigest)) throw new Error('ceremony_package_duplicate'); roleKeys.add(rk);packageByDigest.set(x.packageDigest,x);actors.push(x.actor);}
  distinct(actors,'ceremony_actor_separation');
  const responseDigests:string[]=[]; const classes=new Set<CeremonyExecutionClassV33_49>();
  for(const e of input.responses){const x=e.payload; verify(e,input.trust.roleRegistry,[x.actor.keyId],at,'ceremony_response_signature'); assertDigest(x as unknown as Record<string,unknown>,'responseDigest','ceremony_response_digest'); const pkg=packageByDigest.get(x.packageDigest); if(!pkg||e.issuerKeyId!==pkg.actor.keyId||actorId(x.actor)!==actorId(pkg.actor)||x.ceremonyId!==p.ceremonyId||x.role!==pkg.role||x.ordinal!==pkg.ordinal||time(x.respondedAt,'ceremony_responded_at')>at.getTime()) throw new Error('ceremony_response_binding'); responseDigests.push(x.responseDigest);classes.add(x.executionClass);}
  if(new Set(responseDigests).size!==16||classes.size!==1) throw new Error('ceremony_response_cardinality'); const executionClass=[...classes][0]!;
  let externalCount=0; if(executionClass==='LOCAL_REHEARSAL'){if(input.externalAttestations.length!==0||input.responses.some(r=>r.payload.externalAttestationDigest!==null)) throw new Error('ceremony_local_truth_boundary');} else {
    if(input.externalAttestations.length!==22) throw new Error('ceremony_external_attestation_cardinality'); const responseMap=new Map(input.responses.map(r=>[r.payload.responseDigest,r.payload])); const byResponse=new Map<string,Set<string>>();
    for(const e of input.externalAttestations){verify(e,input.trust.auditorRegistry,input.trust.trustedAuditorIds,at,'ceremony_attestation_signature');const x=e.payload;assertDigest(x as unknown as Record<string,unknown>,'attestationDigest','ceremony_attestation_digest');const resp=responseMap.get(x.responseDigest);if(!resp||x.ceremonyId!==p.ceremonyId||actorId(x.subject)!==actorId(resp.actor)||!input.trust.trustedExternalEvidenceDigests.includes(x.providerEvidenceDigest)||e.issuerKeyId!==x.auditor.keyId||x.auditor.organizationId===x.subject.organizationId||x.auditor.administratorId===x.subject.administratorId)throw new Error('ceremony_attestation_binding');const set=byResponse.get(x.responseDigest)??new Set<string>();if(set.has(e.issuerKeyId))throw new Error('ceremony_attestation_duplicate');set.add(e.issuerKeyId);byResponse.set(x.responseDigest,set);}
    const infrastructureResponses=input.responses.filter(r=>['COORDINATOR_HOST','CLOCK_ROOT','APPEND_ONLY_STORE','PARTITION_OBSERVER'].includes(r.payload.role)); if(infrastructureResponses.some(r=>byResponse.get(r.payload.responseDigest)?.size!==2))throw new Error('ceremony_attestation_quorum'); externalCount=input.externalAttestations.length;
  }
  input.packages.forEach(e=>input.consumedPackageDigests.add(e.payload.packageDigest)); const m={version:'33.49' as const,ceremonyId:p.ceremonyId,policyDigest:p.policyDigest,manifestDigest:p.manifestDigest,baseImportReceiptDigest:p.baseImportReceiptDigest,executionClass,responseDigests:[...responseDigests].sort(),externalAttestationDigests:input.externalAttestations.map(e=>e.payload.attestationDigest).sort(),evidenceExporterKeyId:input.responses.find(r=>r.payload.role==='EVIDENCE_EXPORTER')!.payload.actor.keyId,evidenceImporterKeyId:input.responses.find(r=>r.payload.role==='EVIDENCE_IMPORTER')!.payload.actor.keyId,openedAt:p.issuedAt,closedAt:at.toISOString(),roleCount:16 as const,externalInfrastructureAttestationCount:externalCount,status:'COMPLETED' as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return {...m,transcriptDigest:sha256(m)};
}



export function verifyAndCloseCeremonyV33_49(input:{authority:SigningIdentity;baseImportReceipt:CoordinatorExternalEvidenceImportReceiptV33_48;policy:SignedEnvelope<CeremonyPolicyPayloadV33_49>;packages:readonly SignedEnvelope<CeremonyEnrollmentPackagePayloadV33_49>[];responses:readonly SignedEnvelope<CeremonyEnrollmentResponsePayloadV33_49>[];externalAttestations:readonly SignedEnvelope<CeremonyExternalAttestationPayloadV33_49>[];trust:CeremonyExecutionTrustV33_49;consumedPackageDigests:Set<string>;revokedPolicyDigests:Set<string>;closedAt:Date;}) {
  if (input.authority.keyId !== input.policy.issuerKeyId) throw new Error('ceremony_authority_mismatch');
  const identityRegistry = new KeyRegistry(); identityRegistry.register(input.authority.keyId, input.authority.publicKey);
  if (identityRegistry.fingerprint(input.authority.keyId) !== input.policy.payload.authority.keyFingerprint) throw new Error('ceremony_authority_mismatch');
  const payload = buildCeremonyTranscriptPayloadV33_49(input);
  return signEnvelope(payload, input.authority);
}

export function verifyCeremonyTranscriptV33_49(input:{baseImportReceipt:CoordinatorExternalEvidenceImportReceiptV33_48;policy:SignedEnvelope<CeremonyPolicyPayloadV33_49>;packages:readonly SignedEnvelope<CeremonyEnrollmentPackagePayloadV33_49>[];responses:readonly SignedEnvelope<CeremonyEnrollmentResponsePayloadV33_49>[];externalAttestations:readonly SignedEnvelope<CeremonyExternalAttestationPayloadV33_49>[];transcript:SignedEnvelope<CeremonyTranscriptPayloadV33_49>;trust:CeremonyExecutionTrustV33_49;revokedPolicyDigests:Set<string>;verifiedAt:Date;}) {
  verify(input.transcript,input.trust.authorityRegistry,input.trust.trustedAuthorityIds,input.verifiedAt,'ceremony_transcript_signature');
  const expected = buildCeremonyTranscriptPayloadV33_49({...input,consumedPackageDigests:new Set<string>(),closedAt:new Date(input.transcript.payload.closedAt)});
  if (input.transcript.issuerKeyId !== input.policy.issuerKeyId || sha256(expected) !== sha256(input.transcript.payload)) throw new Error('ceremony_transcript_recompute');
  return {status:'PASS' as const,transcriptDigest:input.transcript.payload.transcriptDigest};
}

// Authority signing is supplied separately because private keys are intentionally not present in verification input.
export function signCeremonyTranscriptV33_49(input:{authority:SigningIdentity; transcriptPayload:CeremonyTranscriptPayloadV33_49}){return signEnvelope(input.transcriptPayload,input.authority);}

export function createCeremonyTransferChallengeV33_49(input:{importer:SigningIdentity;ceremonyId:string;transcriptDigest:string;nonce:Uint8Array;issuedAt:Date;expiresAt:Date;}){if(input.nonce.byteLength<32||input.expiresAt<=input.issuedAt)throw new Error('ceremony_transfer_challenge_input');const m={version:'33.49' as const,ceremonyId:input.ceremonyId,transcriptDigest:input.transcriptDigest,nonceDigest:sha256Bytes(input.nonce),issuedAt:input.issuedAt.toISOString(),expiresAt:input.expiresAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};return signEnvelope({...m,challengeDigest:sha256(m)},input.importer);}
export function createCeremonySealedTransferV33_49(input:{exporter:SigningIdentity;ceremonyId:string;transcriptDigest:string;challengeDigest:string;files:Readonly<Record<string,{bytes:Uint8Array;mediaType:string}>>;exportedAt:Date;}){const entries=Object.entries(input.files).map(([path,row])=>{if(!safePath(path))throw new Error('ceremony_transfer_path');return{path,byteLength:row.bytes.byteLength,sha256:sha256Bytes(row.bytes),mediaType:row.mediaType};}).sort((a,b)=>a.path.localeCompare(b.path));if(entries.length===0||new Set(entries.map(x=>x.path)).size!==entries.length)throw new Error('ceremony_transfer_inventory');const m={version:'33.49' as const,ceremonyId:input.ceremonyId,transcriptDigest:input.transcriptDigest,challengeDigest:input.challengeDigest,files:entries,exportedAt:input.exportedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};return signEnvelope({...m,transferDigest:sha256(m)},input.exporter);}
export function createCeremonyRevocationApprovalV33_49(input:{custodian:SigningIdentity;ceremonyId:string;policyDigest:string;reasonCode:string;approvedAt:Date;}){if(input.reasonCode.trim()==='')throw new Error('ceremony_revocation_reason');const m={version:'33.49' as const,ceremonyId:input.ceremonyId,policyDigest:input.policyDigest,reasonCode:input.reasonCode,approvedAt:input.approvedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};return signEnvelope({...m,approvalDigest:sha256(m)},input.custodian);}
export function createCeremonyRevocationCertificateV33_49(input:{authority:SigningIdentity;policy:SignedEnvelope<CeremonyPolicyPayloadV33_49>;approvals:readonly SignedEnvelope<CeremonyRevocationApprovalPayloadV33_49>[];trust:CeremonyExecutionTrustV33_49;reasonCode:string;revokedAt:Date;}){if(input.approvals.length<3)throw new Error('ceremony_revocation_quorum');const issuers=new Set<string>();for(const e of input.approvals){verify(e,input.trust.revocationCustodianRegistry,input.trust.trustedRevocationCustodianIds,input.revokedAt,'ceremony_revocation_approval_signature');assertDigest(e.payload as unknown as Record<string,unknown>,'approvalDigest','ceremony_revocation_approval_digest');if(e.payload.ceremonyId!==input.policy.payload.ceremonyId||e.payload.policyDigest!==input.policy.payload.policyDigest||e.payload.reasonCode!==input.reasonCode||issuers.has(e.issuerKeyId))throw new Error('ceremony_revocation_approval_binding');issuers.add(e.issuerKeyId);}if(issuers.size<3)throw new Error('ceremony_revocation_quorum');const m={version:'33.49' as const,ceremonyId:input.policy.payload.ceremonyId,policyDigest:input.policy.payload.policyDigest,approvalDigests:input.approvals.map(e=>e.payload.approvalDigest).sort(),reasonCode:input.reasonCode,revokedAt:input.revokedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};return signEnvelope({...m,revocationDigest:sha256(m)},input.authority);}


export function verifyCeremonyRevocationCertificateV33_49(input:{policy:SignedEnvelope<CeremonyPolicyPayloadV33_49>;certificate:SignedEnvelope<CeremonyRevocationCertificatePayloadV33_49>;approvals:readonly SignedEnvelope<CeremonyRevocationApprovalPayloadV33_49>[];trust:CeremonyExecutionTrustV33_49;verifiedAt:Date;revokedPolicyDigests:Set<string>;}){
  verify(input.policy,input.trust.authorityRegistry,input.trust.trustedAuthorityIds,input.verifiedAt,'ceremony_revoke_policy_signature');
  verify(input.certificate,input.trust.revocationAuthorityRegistry,input.trust.trustedRevocationAuthorityIds,input.verifiedAt,'ceremony_revocation_certificate_signature');
  assertDigest(input.certificate.payload as unknown as Record<string,unknown>,'revocationDigest','ceremony_revocation_certificate_digest');
  if(input.certificate.payload.ceremonyId!==input.policy.payload.ceremonyId||input.certificate.payload.policyDigest!==input.policy.payload.policyDigest)throw new Error('ceremony_revocation_certificate_binding');
  const issuers=new Set<string>(); const digests:string[]=[];
  for(const e of input.approvals){verify(e,input.trust.revocationCustodianRegistry,input.trust.trustedRevocationCustodianIds,input.verifiedAt,'ceremony_revocation_verify_approval_signature');assertDigest(e.payload as unknown as Record<string,unknown>,'approvalDigest','ceremony_revocation_verify_approval_digest');if(e.payload.ceremonyId!==input.policy.payload.ceremonyId||e.payload.policyDigest!==input.policy.payload.policyDigest||e.payload.reasonCode!==input.certificate.payload.reasonCode||issuers.has(e.issuerKeyId))throw new Error('ceremony_revocation_verify_approval_binding');issuers.add(e.issuerKeyId);digests.push(e.payload.approvalDigest);}
  if(issuers.size<3||JSON.stringify(digests.sort())!==JSON.stringify([...input.certificate.payload.approvalDigests].sort()))throw new Error('ceremony_revocation_verify_quorum');
  input.revokedPolicyDigests.add(input.policy.payload.policyDigest); return {status:'REVOKED' as const,policyDigest:input.policy.payload.policyDigest,revocationDigest:input.certificate.payload.revocationDigest};
}

export function verifyCeremonyTransferImportV33_49(input:{revokedPolicyDigests:Set<string>;baseImportReceipt:CoordinatorExternalEvidenceImportReceiptV33_48;policy:SignedEnvelope<CeremonyPolicyPayloadV33_49>;transcript:SignedEnvelope<CeremonyTranscriptPayloadV33_49>;challenge:SignedEnvelope<CeremonyTransferChallengePayloadV33_49>;transfer:SignedEnvelope<CeremonySealedTransferPayloadV33_49>;fileBytes:Readonly<Record<string,Uint8Array>>;trust:CeremonyExecutionTrustV33_49;consumedChallengeDigests:Set<string>;importedAt:Date;}) : CeremonyExecutionReceiptV33_49 {
  const at=input.importedAt;if(input.revokedPolicyDigests.has(input.policy.payload.policyDigest))throw new Error('ceremony_import_policy_revoked');verify(input.policy,input.trust.authorityRegistry,input.trust.trustedAuthorityIds,at,'ceremony_import_policy_signature');assertDigest(input.policy.payload as unknown as Record<string,unknown>,'policyDigest','ceremony_import_policy_digest');verify(input.transcript,input.trust.authorityRegistry,input.trust.trustedAuthorityIds,at,'ceremony_import_transcript_signature');assertDigest(input.transcript.payload as unknown as Record<string,unknown>,'transcriptDigest','ceremony_import_transcript_digest');if(input.transcript.payload.policyDigest!==input.policy.payload.policyDigest||input.transcript.payload.baseImportReceiptDigest!==input.baseImportReceipt.receiptDigest||input.transcript.payload.status!=='COMPLETED')throw new Error('ceremony_import_transcript_binding');verify(input.challenge,input.trust.importerRegistry,input.trust.trustedImporterIds,at,'ceremony_import_challenge_signature');if(input.challenge.issuerKeyId!==input.transcript.payload.evidenceImporterKeyId)throw new Error('ceremony_import_challenge_issuer');assertDigest(input.challenge.payload as unknown as Record<string,unknown>,'challengeDigest','ceremony_import_challenge_digest');if(input.challenge.payload.ceremonyId!==input.policy.payload.ceremonyId||input.challenge.payload.transcriptDigest!==input.transcript.payload.transcriptDigest||at.getTime()>time(input.challenge.payload.expiresAt,'ceremony_import_challenge_expired')||input.consumedChallengeDigests.has(input.challenge.payload.challengeDigest))throw new Error('ceremony_import_challenge_binding');verify(input.transfer,input.trust.exporterRegistry,input.trust.trustedExporterIds,at,'ceremony_import_transfer_signature');if(input.transfer.issuerKeyId!==input.transcript.payload.evidenceExporterKeyId)throw new Error('ceremony_import_transfer_issuer');assertDigest(input.transfer.payload as unknown as Record<string,unknown>,'transferDigest','ceremony_import_transfer_digest');if(input.transfer.payload.ceremonyId!==input.policy.payload.ceremonyId||input.transfer.payload.transcriptDigest!==input.transcript.payload.transcriptDigest||input.transfer.payload.challengeDigest!==input.challenge.payload.challengeDigest)throw new Error('ceremony_import_transfer_binding');const expected=input.transfer.payload.files.map(x=>x.path).sort();const actual=Object.keys(input.fileBytes).sort();if(JSON.stringify(expected)!==JSON.stringify(actual)||new Set(expected).size!==expected.length)throw new Error('ceremony_import_inventory_set');for(const f of input.transfer.payload.files){const b=input.fileBytes[f.path];if(!b||b.byteLength!==f.byteLength||sha256Bytes(b)!==f.sha256)throw new Error('ceremony_import_inventory_bytes');}input.consumedChallengeDigests.add(input.challenge.payload.challengeDigest);const external=input.transcript.payload.executionClass==='LIVE_EXTERNAL';if(external&&input.transcript.payload.externalInfrastructureAttestationCount!==22)throw new Error('ceremony_import_external_quorum');if(!external&&input.transcript.payload.externalInfrastructureAttestationCount!==0)throw new Error('ceremony_import_local_truth_boundary');const m={version:'33.49' as const,status:(external?'EXTERNAL_CEREMONY_EVIDENCE_READY_FOR_IMPORT':'LOCAL_EXTERNAL_CEREMONY_EXECUTION_REHEARSAL_ONLY') as CeremonyExecutionReceiptV33_49['status'],ceremonyId:input.policy.payload.ceremonyId,policyDigest:input.policy.payload.policyDigest,transcriptDigest:input.transcript.payload.transcriptDigest,transferDigest:input.transfer.payload.transferDigest,baseImportReceiptDigest:input.baseImportReceipt.receiptDigest,roleCount:16 as const,externalAttestationCount:input.transcript.payload.externalInfrastructureAttestationCount,exactTransferInventoryVerified:true as const,replayProtectionVerified:true as const,externalCeremonyObserved:external,externalHumanParticipants:0 as const,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const,importedAt:at.toISOString()};return{...m,receiptDigest:sha256(m)};
}
