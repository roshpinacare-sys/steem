import { KeyRegistry, sha256, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { InfrastructureActorV33_53, PersistenceInfrastructureQualificationVerdictPayloadV33_53 } from './evidence-intake-operations-persistence-qualification-v33_53.js';

export const EXECUTION_ROLES_V33_54 = [
  'QUEUE_STORE_1','QUEUE_STORE_2','QUEUE_STORE_3','WORKER_1','WORKER_2',
  'LEASE_CLOCK_1','LEASE_CLOCK_2','PARTITION_OBSERVER_1','PARTITION_OBSERVER_2','RECOVERY_OPERATOR',
] as const;
export type ExecutionRoleV33_54 = typeof EXECUTION_ROLES_V33_54[number];
export type ExecutionTopologyV33_54 = 'LOCAL_MULTI_PROCESS_REHEARSAL' | 'INDEPENDENT_EXTERNAL_EXECUTION';
export type DrillKindV33_54 = 'NETWORK_PARTITION' | 'OVERLOAD_BACKPRESSURE' | 'SITE_LOSS_RECOVERY';

export interface ExecutionPolicyPayloadV33_54 {
  readonly version: '33.54';
  readonly executionId: string;
  readonly baseQualificationVerdictDigest: string;
  readonly authority: InfrastructureActorV33_53;
  readonly requiredRoles: readonly ExecutionRoleV33_54[];
  readonly auditorQuorumPerRole: 2;
  readonly requiredDrills: readonly DrillKindV33_54[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly policyDigest: string;
}
export interface RoleEnrollmentPayloadV33_54 {
  readonly version: '33.54';
  readonly executionId: string;
  readonly policyDigest: string;
  readonly role: ExecutionRoleV33_54;
  readonly actor: InfrastructureActorV33_53;
  readonly challengeNonce: string;
  readonly sequence: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly enrollmentDigest: string;
}
export interface RoleExecutionResponsePayloadV33_54 {
  readonly version: '33.54';
  readonly executionId: string;
  readonly policyDigest: string;
  readonly role: ExecutionRoleV33_54;
  readonly enrollmentDigest: string;
  readonly actor: InfrastructureActorV33_53;
  readonly endpoint: string;
  readonly processId: number;
  readonly processAttestationDigest: string;
  readonly topology: ExecutionTopologyV33_54;
  readonly externalEvidenceDigest: string | null;
  readonly challengeNonce: string;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly responseDigest: string;
}
export interface RoleAuditAttestationPayloadV33_54 {
  readonly version: '33.54';
  readonly executionId: string;
  readonly policyDigest: string;
  readonly role: ExecutionRoleV33_54;
  readonly responseDigest: string;
  readonly auditor: InfrastructureActorV33_53;
  readonly decision: 'APPROVE';
  readonly topology: ExecutionTopologyV33_54;
  readonly externalEvidenceDigest: string | null;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly attestationDigest: string;
}
export interface ExecutionDrillReceiptPayloadV33_54 {
  readonly version: '33.54';
  readonly executionId: string;
  readonly policyDigest: string;
  readonly kind: DrillKindV33_54;
  readonly executor: InfrastructureActorV33_53;
  readonly participantResponseDigests: readonly string[];
  readonly evidenceFileDigests: readonly string[];
  readonly outcome: 'PASS';
  readonly topology: ExecutionTopologyV33_54;
  readonly externalEvidenceDigest: string | null;
  readonly executedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}
export interface ExecutionEvidenceFileV33_54 {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly mediaType: string;
}
export interface ExecutionEvidenceBundlePayloadV33_54 {
  readonly version: '33.54';
  readonly executionId: string;
  readonly policyDigest: string;
  readonly enrollmentDigests: readonly string[];
  readonly responseDigests: readonly string[];
  readonly auditAttestationDigests: readonly string[];
  readonly drillReceiptDigests: readonly string[];
  readonly files: readonly ExecutionEvidenceFileV33_54[];
  readonly topology: ExecutionTopologyV33_54;
  readonly externalEvidenceDigest: string | null;
  readonly sealedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly bundleDigest: string;
}
export interface QualificationExecutionVerdictPayloadV33_54 {
  readonly version: '33.54';
  readonly status: 'LOCAL_QUALIFICATION_EXECUTION_REHEARSAL_ONLY' | 'EXTERNAL_QUALIFICATION_EXECUTION_VERIFIED';
  readonly executionId: string;
  readonly policyDigest: string;
  readonly baseQualificationVerdictDigest: string;
  readonly enrollmentDigests: readonly string[];
  readonly responseDigests: readonly string[];
  readonly auditAttestationDigests: readonly string[];
  readonly drillReceiptDigests: readonly string[];
  readonly evidenceBundleDigest: string;
  readonly requiredRoleCount: 10;
  readonly acceptedRoleCount: 10;
  readonly auditorAttestationCount: 20;
  readonly drillCount: 3;
  readonly processIsolationVerified: true;
  readonly dualAuditVerified: true;
  readonly partitionDrillVerified: true;
  readonly overloadDrillVerified: true;
  readonly siteLossRecoveryVerified: true;
  readonly portableEvidencePathsVerified: true;
  readonly externalTopologyObserved: boolean;
  readonly externalInfrastructureAttestations: number;
  readonly externalHumanParticipants: number;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verifiedAt: string;
  readonly verdictDigest: string;
}
export interface QualificationExecutionTrustV33_54 {
  readonly policyRegistry: KeyRegistry; readonly trustedPolicySignerIds: readonly string[];
  readonly enrollmentRegistry: KeyRegistry; readonly trustedEnrollmentSignerIds: readonly string[];
  readonly responseRegistry: KeyRegistry; readonly trustedResponseSignerIds: readonly string[];
  readonly auditorRegistry: KeyRegistry; readonly trustedAuditorSignerIds: readonly string[];
  readonly drillRegistry: KeyRegistry; readonly trustedDrillSignerIds: readonly string[];
  readonly bundleRegistry: KeyRegistry; readonly trustedBundleSignerIds: readonly string[];
  readonly verdictRegistry: KeyRegistry; readonly trustedVerdictSignerIds: readonly string[];
  readonly baseRegistry: KeyRegistry; readonly trustedBaseSignerIds: readonly string[];
  readonly trustedExternalEvidenceDigests: readonly string[];
}

const HEX64=/^[0-9a-f]{64}$/;
const digestWithout=<T extends Record<string,unknown>>(payload:T,key:keyof T)=>{const copy={...payload};delete copy[key];return sha256(copy);};
const assertDigest=(payload:Record<string,unknown>,key:string,code:string)=>{const value=payload[key];if(typeof value!=='string'||!HEX64.test(value)||digestWithout(payload,key)!==value)throw new Error(code);};
const requireDigest=(value:string,code:string)=>{if(!HEX64.test(value))throw new Error(code);};
const parseTime=(value:string,code:string)=>{const n=Date.parse(value);if(!Number.isFinite(n))throw new Error(code);return n;};
const verifyEnvelope=<T>(env:SignedEnvelope<T>,registry:KeyRegistry,ids:readonly string[],at:Date,code:string)=>{if(!ids.includes(env.issuerKeyId)||!registry.verifyAt(env,at))throw new Error(code);};
const actorKey=(actor:InfrastructureActorV33_53)=>`${actor.keyId}|${actor.organizationId}|${actor.administratorId}|${actor.hostId}|${actor.siteId}|${actor.providerId}`;
const assertActor=(actor:InfrastructureActorV33_53,code:string)=>{if(Object.values(actor).some(v=>typeof v!=='string'||v.trim()===''))throw new Error(code);};
const distinctBy=(actors:readonly InfrastructureActorV33_53[],field:keyof InfrastructureActorV33_53,code:string)=>{if(new Set(actors.map(a=>a[field])).size!==actors.length)throw new Error(code);};
const publicEndpoint=(endpoint:string)=>/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/|$)/i.test(endpoint)&&!/(localhost|\.local(?:\/|$)|\.invalid(?:\/|$)|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)/i.test(endpoint);
const portablePath=(path:string)=>path!==''&&!path.startsWith('/')&&!path.includes('..')&&!path.includes('\\')&&!/^[A-Za-z]:/.test(path);
const sortedUnique=(items:readonly string[])=>[...new Set(items)].sort();

export function createExecutionPolicyV33_54(input:{signer:SigningIdentity;executionId:string;baseVerdict:SignedEnvelope<PersistenceInfrastructureQualificationVerdictPayloadV33_53>;authority:InfrastructureActorV33_53;issuedAt:Date;expiresAt:Date}){
  assertActor(input.authority,'policy_authority');
  if(input.signer.keyId!==input.authority.keyId||input.executionId.trim()===''||input.issuedAt>=input.expiresAt)throw new Error('policy_input');
  const material={version:'33.54' as const,executionId:input.executionId,baseQualificationVerdictDigest:input.baseVerdict.payload.verdictDigest,authority:input.authority,requiredRoles:[...EXECUTION_ROLES_V33_54],auditorQuorumPerRole:2 as const,requiredDrills:['NETWORK_PARTITION','OVERLOAD_BACKPRESSURE','SITE_LOSS_RECOVERY'] as const,issuedAt:input.issuedAt.toISOString(),expiresAt:input.expiresAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...material,policyDigest:sha256(material)},input.signer);
}
export function createRoleEnrollmentV33_54(input:{signer:SigningIdentity;policy:SignedEnvelope<ExecutionPolicyPayloadV33_54>;role:ExecutionRoleV33_54;actor:InfrastructureActorV33_53;challengeNonce:string;sequence:number;issuedAt:Date;expiresAt:Date}){
  assertActor(input.actor,'enrollment_actor');
  if(!input.policy.payload.requiredRoles.includes(input.role)||input.signer.keyId!==input.policy.payload.authority.keyId||input.challengeNonce.trim()===''||input.sequence<1||input.issuedAt>=input.expiresAt||input.expiresAt.getTime()>Date.parse(input.policy.payload.expiresAt))throw new Error('enrollment_input');
  const material={version:'33.54' as const,executionId:input.policy.payload.executionId,policyDigest:input.policy.payload.policyDigest,role:input.role,actor:input.actor,challengeNonce:input.challengeNonce,sequence:input.sequence,issuedAt:input.issuedAt.toISOString(),expiresAt:input.expiresAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...material,enrollmentDigest:sha256(material)},input.signer);
}
export function createRoleExecutionResponseV33_54(input:{signer:SigningIdentity;policy:SignedEnvelope<ExecutionPolicyPayloadV33_54>;enrollment:SignedEnvelope<RoleEnrollmentPayloadV33_54>;endpoint:string;processId:number;processAttestationDigest:string;topology:ExecutionTopologyV33_54;externalEvidenceDigest:string|null;challengeNonce:string;observedAt:Date}){
  requireDigest(input.processAttestationDigest,'response_process_digest');
  if(input.signer.keyId!==input.enrollment.payload.actor.keyId||input.challengeNonce!==input.enrollment.payload.challengeNonce||input.processId<1||input.endpoint.trim()===''||input.observedAt.getTime()>Date.parse(input.enrollment.payload.expiresAt)||input.enrollment.payload.policyDigest!==input.policy.payload.policyDigest)throw new Error('response_input');
  if(input.topology==='INDEPENDENT_EXTERNAL_EXECUTION'&&(input.externalEvidenceDigest===null||!publicEndpoint(input.endpoint)))throw new Error('response_external_evidence');
  if(input.externalEvidenceDigest!==null)requireDigest(input.externalEvidenceDigest,'response_external_digest');
  const material={version:'33.54' as const,executionId:input.policy.payload.executionId,policyDigest:input.policy.payload.policyDigest,role:input.enrollment.payload.role,enrollmentDigest:input.enrollment.payload.enrollmentDigest,actor:input.enrollment.payload.actor,endpoint:input.endpoint,processId:input.processId,processAttestationDigest:input.processAttestationDigest,topology:input.topology,externalEvidenceDigest:input.externalEvidenceDigest,challengeNonce:input.challengeNonce,observedAt:input.observedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...material,responseDigest:sha256(material)},input.signer);
}
export function createRoleAuditAttestationV33_54(input:{signer:SigningIdentity;policy:SignedEnvelope<ExecutionPolicyPayloadV33_54>;response:SignedEnvelope<RoleExecutionResponsePayloadV33_54>;auditor:InfrastructureActorV33_53;topology:ExecutionTopologyV33_54;externalEvidenceDigest:string|null;observedAt:Date}){
  assertActor(input.auditor,'audit_actor');
  if(input.signer.keyId!==input.auditor.keyId||input.auditor.organizationId===input.response.payload.actor.organizationId||input.auditor.administratorId===input.response.payload.actor.administratorId)throw new Error('audit_independence');
  if(input.topology==='INDEPENDENT_EXTERNAL_EXECUTION'&&input.externalEvidenceDigest===null)throw new Error('audit_external_evidence');
  if(input.externalEvidenceDigest!==null)requireDigest(input.externalEvidenceDigest,'audit_external_digest');
  const material={version:'33.54' as const,executionId:input.policy.payload.executionId,policyDigest:input.policy.payload.policyDigest,role:input.response.payload.role,responseDigest:input.response.payload.responseDigest,auditor:input.auditor,decision:'APPROVE' as const,topology:input.topology,externalEvidenceDigest:input.externalEvidenceDigest,observedAt:input.observedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...material,attestationDigest:sha256(material)},input.signer);
}
export function createExecutionDrillReceiptV33_54(input:{signer:SigningIdentity;policy:SignedEnvelope<ExecutionPolicyPayloadV33_54>;kind:DrillKindV33_54;executor:InfrastructureActorV33_53;participantResponses:readonly SignedEnvelope<RoleExecutionResponsePayloadV33_54>[];evidenceFileDigests:readonly string[];topology:ExecutionTopologyV33_54;externalEvidenceDigest:string|null;executedAt:Date}){
  assertActor(input.executor,'drill_executor');
  if(input.signer.keyId!==input.executor.keyId||!input.policy.payload.requiredDrills.includes(input.kind)||input.participantResponses.length<2||input.evidenceFileDigests.length<1)throw new Error('drill_input');
  input.evidenceFileDigests.forEach(d=>requireDigest(d,'drill_file_digest'));
  if(input.topology==='INDEPENDENT_EXTERNAL_EXECUTION'&&input.externalEvidenceDigest===null)throw new Error('drill_external_evidence');
  if(input.externalEvidenceDigest!==null)requireDigest(input.externalEvidenceDigest,'drill_external_digest');
  const material={version:'33.54' as const,executionId:input.policy.payload.executionId,policyDigest:input.policy.payload.policyDigest,kind:input.kind,executor:input.executor,participantResponseDigests:sortedUnique(input.participantResponses.map(r=>r.payload.responseDigest)),evidenceFileDigests:sortedUnique(input.evidenceFileDigests),outcome:'PASS' as const,topology:input.topology,externalEvidenceDigest:input.externalEvidenceDigest,executedAt:input.executedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...material,receiptDigest:sha256(material)},input.signer);
}
export function createExecutionEvidenceBundleV33_54(input:{signer:SigningIdentity;policy:SignedEnvelope<ExecutionPolicyPayloadV33_54>;enrollments:readonly SignedEnvelope<RoleEnrollmentPayloadV33_54>[];responses:readonly SignedEnvelope<RoleExecutionResponsePayloadV33_54>[];audits:readonly SignedEnvelope<RoleAuditAttestationPayloadV33_54>[];drills:readonly SignedEnvelope<ExecutionDrillReceiptPayloadV33_54>[];files:readonly ExecutionEvidenceFileV33_54[];topology:ExecutionTopologyV33_54;externalEvidenceDigest:string|null;sealedAt:Date}){
  if(input.files.length<1||input.files.some(f=>!portablePath(f.path)||f.byteLength<1||!HEX64.test(f.sha256)||f.mediaType.trim()===''))throw new Error('bundle_file_inventory');
  if(new Set(input.files.map(f=>f.path)).size!==input.files.length)throw new Error('bundle_duplicate_path');
  if(input.topology==='INDEPENDENT_EXTERNAL_EXECUTION'&&input.externalEvidenceDigest===null)throw new Error('bundle_external_evidence');
  if(input.externalEvidenceDigest!==null)requireDigest(input.externalEvidenceDigest,'bundle_external_digest');
  const material={version:'33.54' as const,executionId:input.policy.payload.executionId,policyDigest:input.policy.payload.policyDigest,enrollmentDigests:sortedUnique(input.enrollments.map(x=>x.payload.enrollmentDigest)),responseDigests:sortedUnique(input.responses.map(x=>x.payload.responseDigest)),auditAttestationDigests:sortedUnique(input.audits.map(x=>x.payload.attestationDigest)),drillReceiptDigests:sortedUnique(input.drills.map(x=>x.payload.receiptDigest)),files:[...input.files].sort((a,b)=>a.path.localeCompare(b.path)),topology:input.topology,externalEvidenceDigest:input.externalEvidenceDigest,sealedAt:input.sealedAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...material,bundleDigest:sha256(material)},input.signer);
}

export function qualifyExecutionBundleV33_54(input:{signer:SigningIdentity;policy:SignedEnvelope<ExecutionPolicyPayloadV33_54>;baseVerdict:SignedEnvelope<PersistenceInfrastructureQualificationVerdictPayloadV33_53>;enrollments:readonly SignedEnvelope<RoleEnrollmentPayloadV33_54>[];responses:readonly SignedEnvelope<RoleExecutionResponsePayloadV33_54>[];audits:readonly SignedEnvelope<RoleAuditAttestationPayloadV33_54>[];drills:readonly SignedEnvelope<ExecutionDrillReceiptPayloadV33_54>[];bundle:SignedEnvelope<ExecutionEvidenceBundlePayloadV33_54>;trust:QualificationExecutionTrustV33_54;verifiedAt:Date}){
  const at=input.verifiedAt;
  verifyEnvelope(input.policy,input.trust.policyRegistry,input.trust.trustedPolicySignerIds,at,'policy_signature');assertDigest(input.policy.payload as unknown as Record<string,unknown>,'policyDigest','policy_digest');
  verifyEnvelope(input.baseVerdict,input.trust.baseRegistry,input.trust.trustedBaseSignerIds,at,'base_signature');assertDigest(input.baseVerdict.payload as unknown as Record<string,unknown>,'verdictDigest','base_digest');
  if(input.policy.payload.baseQualificationVerdictDigest!==input.baseVerdict.payload.verdictDigest||at.getTime()<Date.parse(input.policy.payload.issuedAt)||at.getTime()>Date.parse(input.policy.payload.expiresAt)||input.policy.payload.productionAuthority!=='NONE'||input.policy.payload.externalEffectsExecuted!==0)throw new Error('policy_contract');
  if(input.enrollments.length!==10)throw new Error('enrollment_count');
  const enrollmentByRole=new Map<ExecutionRoleV33_54,SignedEnvelope<RoleEnrollmentPayloadV33_54>>();const enrolledActors:InfrastructureActorV33_53[]=[];const nonces=new Set<string>();
  for(const e of input.enrollments){verifyEnvelope(e,input.trust.enrollmentRegistry,input.trust.trustedEnrollmentSignerIds,at,'enrollment_signature');assertDigest(e.payload as unknown as Record<string,unknown>,'enrollmentDigest','enrollment_digest');if(e.issuerKeyId!==input.policy.payload.authority.keyId||e.payload.executionId!==input.policy.payload.executionId||e.payload.policyDigest!==input.policy.payload.policyDigest||enrollmentByRole.has(e.payload.role)||e.payload.sequence<1||parseTime(e.payload.expiresAt,'enrollment_expiry')<at.getTime()||nonces.has(e.payload.challengeNonce))throw new Error('enrollment_contract');enrollmentByRole.set(e.payload.role,e);enrolledActors.push(e.payload.actor);nonces.add(e.payload.challengeNonce);}
  if(EXECUTION_ROLES_V33_54.some(r=>!enrollmentByRole.has(r)))throw new Error('enrollment_roles');
  for(const field of ['keyId','organizationId','administratorId','hostId'] as const)distinctBy(enrolledActors,field,'enrollment_actor_separation');
  if(input.responses.length!==10)throw new Error('response_count');
  const responseByRole=new Map<ExecutionRoleV33_54,SignedEnvelope<RoleExecutionResponsePayloadV33_54>>();const processIds=new Set<number>();
  for(const r of input.responses){verifyEnvelope(r,input.trust.responseRegistry,input.trust.trustedResponseSignerIds,at,'response_signature');assertDigest(r.payload as unknown as Record<string,unknown>,'responseDigest','response_digest');const e=enrollmentByRole.get(r.payload.role);if(!e||r.issuerKeyId!==e.payload.actor.keyId||r.payload.enrollmentDigest!==e.payload.enrollmentDigest||actorKey(r.payload.actor)!==actorKey(e.payload.actor)||r.payload.challengeNonce!==e.payload.challengeNonce||r.payload.policyDigest!==input.policy.payload.policyDigest||responseByRole.has(r.payload.role)||processIds.has(r.payload.processId))throw new Error('response_contract');responseByRole.set(r.payload.role,r);processIds.add(r.payload.processId);}
  if(input.audits.length!==20)throw new Error('audit_count');
  const auditsByRole=new Map<ExecutionRoleV33_54,SignedEnvelope<RoleAuditAttestationPayloadV33_54>[]>();
  for(const a of input.audits){verifyEnvelope(a,input.trust.auditorRegistry,input.trust.trustedAuditorSignerIds,at,'audit_signature');assertDigest(a.payload as unknown as Record<string,unknown>,'attestationDigest','audit_digest');const r=responseByRole.get(a.payload.role);if(!r||a.payload.responseDigest!==r.payload.responseDigest||a.payload.policyDigest!==input.policy.payload.policyDigest||a.payload.decision!=='APPROVE'||a.issuerKeyId!==a.payload.auditor.keyId)throw new Error('audit_contract');const list=auditsByRole.get(a.payload.role)??[];list.push(a);auditsByRole.set(a.payload.role,list);}
  for(const role of EXECUTION_ROLES_V33_54){const list=auditsByRole.get(role)??[];if(list.length!==2)throw new Error('audit_quorum');distinctBy(list.map(a=>a.payload.auditor),'keyId','audit_key_collision');distinctBy(list.map(a=>a.payload.auditor),'organizationId','audit_org_collision');distinctBy(list.map(a=>a.payload.auditor),'administratorId','audit_admin_collision');}
  if(input.drills.length!==3)throw new Error('drill_count');const drillByKind=new Map<DrillKindV33_54,SignedEnvelope<ExecutionDrillReceiptPayloadV33_54>>();
  for(const d of input.drills){verifyEnvelope(d,input.trust.drillRegistry,input.trust.trustedDrillSignerIds,at,'drill_signature');assertDigest(d.payload as unknown as Record<string,unknown>,'receiptDigest','drill_digest');if(d.payload.policyDigest!==input.policy.payload.policyDigest||d.payload.outcome!=='PASS'||drillByKind.has(d.payload.kind)||d.payload.participantResponseDigests.some(x=>![...responseByRole.values()].some(r=>r.payload.responseDigest===x)))throw new Error('drill_contract');drillByKind.set(d.payload.kind,d);}
  if(input.policy.payload.requiredDrills.some(k=>!drillByKind.has(k)))throw new Error('drill_kinds');
  verifyEnvelope(input.bundle,input.trust.bundleRegistry,input.trust.trustedBundleSignerIds,at,'bundle_signature');assertDigest(input.bundle.payload as unknown as Record<string,unknown>,'bundleDigest','bundle_digest');
  const expectedEnroll=sortedUnique(input.enrollments.map(x=>x.payload.enrollmentDigest)),expectedResponses=sortedUnique(input.responses.map(x=>x.payload.responseDigest)),expectedAudits=sortedUnique(input.audits.map(x=>x.payload.attestationDigest)),expectedDrills=sortedUnique(input.drills.map(x=>x.payload.receiptDigest));
  if(input.bundle.payload.policyDigest!==input.policy.payload.policyDigest||JSON.stringify(input.bundle.payload.enrollmentDigests)!==JSON.stringify(expectedEnroll)||JSON.stringify(input.bundle.payload.responseDigests)!==JSON.stringify(expectedResponses)||JSON.stringify(input.bundle.payload.auditAttestationDigests)!==JSON.stringify(expectedAudits)||JSON.stringify(input.bundle.payload.drillReceiptDigests)!==JSON.stringify(expectedDrills)||input.bundle.payload.files.some(f=>!portablePath(f.path)))throw new Error('bundle_contract');
  const trusted=(d:string|null)=>d!==null&&input.trust.trustedExternalEvidenceDigests.includes(d);
  const externalResponses=input.responses.every(r=>r.payload.topology==='INDEPENDENT_EXTERNAL_EXECUTION'&&trusted(r.payload.externalEvidenceDigest)&&publicEndpoint(r.payload.endpoint));
  const externalAudits=input.audits.every(a=>a.payload.topology==='INDEPENDENT_EXTERNAL_EXECUTION'&&trusted(a.payload.externalEvidenceDigest));
  const externalDrills=input.drills.every(d=>d.payload.topology==='INDEPENDENT_EXTERNAL_EXECUTION'&&trusted(d.payload.externalEvidenceDigest));
  const externalBundle=input.bundle.payload.topology==='INDEPENDENT_EXTERNAL_EXECUTION'&&trusted(input.bundle.payload.externalEvidenceDigest);
  const baseExternal=input.baseVerdict.payload.status==='EXTERNAL_PERSISTENCE_INFRASTRUCTURE_QUALIFIED'&&input.baseVerdict.payload.externalTopologyObserved;
  const allExternal=baseExternal&&externalResponses&&externalAudits&&externalDrills&&externalBundle;
  const externalCount=[...input.responses.map(r=>r.payload.externalEvidenceDigest),...input.audits.map(a=>a.payload.externalEvidenceDigest),...input.drills.map(d=>d.payload.externalEvidenceDigest),input.bundle.payload.externalEvidenceDigest].filter(trusted).length;
  const material={version:'33.54' as const,status:(allExternal?'EXTERNAL_QUALIFICATION_EXECUTION_VERIFIED':'LOCAL_QUALIFICATION_EXECUTION_REHEARSAL_ONLY') as QualificationExecutionVerdictPayloadV33_54['status'],executionId:input.policy.payload.executionId,policyDigest:input.policy.payload.policyDigest,baseQualificationVerdictDigest:input.baseVerdict.payload.verdictDigest,enrollmentDigests:expectedEnroll,responseDigests:expectedResponses,auditAttestationDigests:expectedAudits,drillReceiptDigests:expectedDrills,evidenceBundleDigest:input.bundle.payload.bundleDigest,requiredRoleCount:10 as const,acceptedRoleCount:10 as const,auditorAttestationCount:20 as const,drillCount:3 as const,processIsolationVerified:true as const,dualAuditVerified:true as const,partitionDrillVerified:true as const,overloadDrillVerified:true as const,siteLossRecoveryVerified:true as const,portableEvidencePathsVerified:true as const,externalTopologyObserved:allExternal,externalInfrastructureAttestations:externalCount,externalHumanParticipants:allExternal?10:0,productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const,verifiedAt:at.toISOString()};
  return signEnvelope({...material,verdictDigest:sha256(material)},input.signer);
}
export function verifyQualificationExecutionVerdictV33_54(input:{verdict:SignedEnvelope<QualificationExecutionVerdictPayloadV33_54>;recomputed:SignedEnvelope<QualificationExecutionVerdictPayloadV33_54>;trust:QualificationExecutionTrustV33_54;verifiedAt:Date}){
  verifyEnvelope(input.verdict,input.trust.verdictRegistry,input.trust.trustedVerdictSignerIds,input.verifiedAt,'verdict_signature');assertDigest(input.verdict.payload as unknown as Record<string,unknown>,'verdictDigest','verdict_digest');
  if(input.verdict.payload.verdictDigest!==input.recomputed.payload.verdictDigest||sha256(input.verdict.payload)!==sha256(input.recomputed.payload))throw new Error('verdict_recompute');
  if(input.verdict.payload.productionAuthority!=='NONE'||input.verdict.payload.externalEffectsExecuted!==0)throw new Error('verdict_truth_boundary');
  return input.verdict.payload;
}
