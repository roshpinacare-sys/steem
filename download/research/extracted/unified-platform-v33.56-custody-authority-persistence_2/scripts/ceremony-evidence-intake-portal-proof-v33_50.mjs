import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256, sha256Bytes, signEnvelope } from '../dist/src/contracts/crypto.js';
import {
  CeremonyEvidenceIntakePortalV33_50,
  createIntakeMalwareScanV33_50,
  createIntakePortalPolicyV33_50,
  createRoleEvidenceSubmissionV33_50,
  createRoleReplacementApprovalV33_50,
  createRoleReplacementCertificateV33_50,
  issueMutualAuthChannelV33_50,
  verifyIntakeReadinessVerdictV33_50,
  verifyRoleReplacementCertificateV33_50,
} from '../dist/src/supply-chain/ceremony-evidence-intake-portal-v33_50.js';

const BASE=resolve('release-evidence/v33.49/V33_49_EXTERNAL_CEREMONY_EXECUTOR_PROOF.json');
const OUT=resolve('release-evidence/v33.50/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL_PROOF.json');
const ROOT=resolve('release-evidence/v33.50/intake-portal');
const base=JSON.parse(readFileSync(BASE,'utf8'));
const at=(s)=>new Date(s);
const registry=(...ids)=>{const r=new KeyRegistry();for(const i of ids)r.register(i.keyId,i.publicKey);return r;};
const exportedRegistry=(records)=>{const r=new KeyRegistry();for(const record of records)r.registerExported(record);return r;};
const actor=(id,n)=>{const r=registry(id);return{keyId:id.keyId,keyFingerprint:r.fingerprint(id.keyId),organizationId:`${n}-org`,hostId:`${n}.example.com`,administratorId:`${n}-admin`};};
const exportKey=(id)=>registry(id).exportPublicKey(id.keyId);
const durableWrite=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});const fd=openSync(path,'w',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}const dfd=openSync(dirname(path),'r');try{fsyncSync(dfd);}finally{closeSync(dfd);}const reread=readFileSync(path);if(sha256Bytes(reread)!==sha256Bytes(bytes))throw new Error('durable_reread');return{path:relative(ROOT,path).replaceAll('\\','/'),byteLength:bytes.byteLength,sha256:sha256Bytes(bytes),fileFsync:true,directoryFsync:true,rereadVerified:true};};
const jsonBytes=(x)=>Buffer.from(JSON.stringify(x,null,2)+'\n');

const policySigner=generateSigningIdentity('proof-v3350-policy');
const portalSigner=generateSigningIdentity('proof-v3350-portal');
const scanner=generateSigningIdentity('proof-v3350-scanner');
const readiness=generateSigningIdentity('proof-v3350-readiness');
const replacementAuthority=generateSigningIdentity('proof-v3350-replacement-authority');
const custodians=[1,2,3].map(i=>generateSigningIdentity(`proof-v3350-custodian-${i}`));
const transportIds=Array.from({length:16},(_,i)=>generateSigningIdentity(`proof-v3350-transport-${i+1}`));
const replacementTransport=generateSigningIdentity('proof-v3350-replacement-transport');
const policyActor=actor(policySigner,'proof-v3350-policy');const portalActor=actor(portalSigner,'proof-v3350-portal');const scannerActor=actor(scanner,'proof-v3350-scanner');
const replacementActor=actor(replacementTransport,'proof-v3350-replacement');
const baseRoleKeys=base.publicKeys.filter(x=>base.trustedIds.roles.includes(x.keyId));
const roleRegistry=exportedRegistry(baseRoleKeys);for(const id of [...transportIds,replacementTransport])roleRegistry.register(id.keyId,id.publicKey);
const externalAttestations=Array.from({length:22},(_,i)=>sha256({v3350ExternalAttestation:i+1}));
const scannerAttestation=sha256({v3350ExternalScanner:'qualified-fixture-not-observed'});
const trust={
  policyRegistry:registry(policySigner),trustedPolicySignerIds:[policySigner.keyId],
  portalRegistry:registry(portalSigner),trustedPortalSignerIds:[portalSigner.keyId],
  roleRegistry,trustedRoleSignerIds:[...base.trustedIds.roles,...transportIds.map(x=>x.keyId),replacementTransport.keyId],
  scannerRegistry:registry(scanner),trustedScannerSignerIds:[scanner.keyId],
  replacementCustodianRegistry:registry(...custodians),trustedReplacementCustodianIds:custodians.map(x=>x.keyId),
  replacementAuthorityRegistry:registry(replacementAuthority),trustedReplacementAuthorityIds:[replacementAuthority.keyId],
  readinessRegistry:registry(readiness),trustedReadinessSignerIds:[readiness.keyId],
  trustedExternalAttestationDigests:externalAttestations,trustedExternalScannerAttestationDigests:[scannerAttestation],
};
const policy=createIntakePortalPolicyV33_50({signer:policySigner,authority:policyActor,portalId:'v3350-local-intake-portal',ceremonyReceipt:base.importReceipt,authorizedEnrollmentResponses:base.responses,issuedAt:at('2026-07-23T04:01:00Z'),expiresAt:at('2026-07-23T08:00:00Z')});
const replacementIndex=15;const originalResponse=base.responses[replacementIndex];
const replacementApprovals=custodians.map(c=>createRoleReplacementApprovalV33_50({custodian:c,policy,role:originalResponse.payload.role,ordinal:originalResponse.payload.ordinal,replacedActor:originalResponse.payload.actor,replacementActor,reasonCode:'ROLE_HOLDER_UNAVAILABLE',approvedAt:at('2026-07-23T04:02:00Z')}));
const replacementCertificate=createRoleReplacementCertificateV33_50({authority:replacementAuthority,policy,role:originalResponse.payload.role,ordinal:originalResponse.payload.ordinal,replacedActor:originalResponse.payload.actor,replacementActor,approvals:replacementApprovals,reasonCode:'ROLE_HOLDER_UNAVAILABLE',issuedAt:at('2026-07-23T04:03:00Z'),expiresAt:at('2026-07-23T05:30:00Z'),trust});
verifyRoleReplacementCertificateV33_50({policy,certificate:replacementCertificate,approvals:replacementApprovals,trust,verifiedAt:at('2026-07-23T04:04:00Z')});

const portal=new CeremonyEvidenceIntakePortalV33_50(trust,portalSigner,readiness);
const channels=[];const submissions=[];const scans=[];const receipts=[];const artifactBytesByRole=[];const durableWrites=[];
for(let i=0;i<16;i++){
  const enrollmentResponse=base.responses[i];const isReplacement=i===replacementIndex;const transport=isReplacement?replacementTransport:transportIds[i];const roleActor=isReplacement?replacementActor:enrollmentResponse.payload.actor;
  const channel=issueMutualAuthChannelV33_50({portalSigner,portalActor,policy,role:enrollmentResponse.payload.role,ordinal:enrollmentResponse.payload.ordinal,roleActor,transportSignerKeyId:transport.keyId,clientCertificateFingerprint:sha256({clientCertificate:i+1}),serverCertificateFingerprint:sha256({serverCertificate:i+1}),tlsExporterBinding:Buffer.alloc(32,i+1),nonce:Buffer.alloc(32,i+33),issuedAt:at('2026-07-23T04:05:00Z'),expiresAt:at('2026-07-23T04:30:00Z')});
  const path=`role-${String(i+1).padStart(2,'0')}/evidence.json`;const bytes=Buffer.from(JSON.stringify({version:'33.50',role:enrollmentResponse.payload.role,ordinal:enrollmentResponse.payload.ordinal,transportSignerKeyId:transport.keyId,executionClass:'LOCAL_REHEARSAL',externalEvidenceObserved:false})+'\n');const record={path,mediaType:'application/json',byteLength:bytes.byteLength,sha256:sha256Bytes(bytes)};
  const submission=createRoleEvidenceSubmissionV33_50({roleSigner:transport,actor:roleActor,policy,channel,enrollmentResponse,executionClass:'LOCAL_REHEARSAL',files:[record],externalAttestationDigests:[],submittedAt:at('2026-07-23T04:06:00Z')});
  const scan=createIntakeMalwareScanV33_50({scannerSigner:scanner,scannerActor,policy,submission,fileBytes:{[path]:bytes},scannerEngine:'BUILTIN_STATIC_V33_50',externalScannerAttestationDigest:null,scannedAt:at('2026-07-23T04:07:00Z')});
  const receipt=portal.intake({policy,ceremonyReceipt:base.importReceipt,channel,enrollmentResponse,submission,scan,fileBytes:{[path]:bytes},acceptedAt:at('2026-07-23T04:08:00Z'),...(isReplacement?{replacementCertificate}:{})});
  channels.push(channel);submissions.push(submission);scans.push(scan);receipts.push(receipt);artifactBytesByRole.push({path,bytesBase64:bytes.toString('base64')});
  const dir=join(ROOT,`role-${String(i+1).padStart(2,'0')}`);durableWrites.push(durableWrite(join(dir,'channel.json'),jsonBytes(channel)),durableWrite(join(dir,'submission.json'),jsonBytes(submission)),durableWrite(join(dir,'scan.json'),jsonBytes(scan)),durableWrite(join(dir,'receipt.json'),jsonBytes(receipt)),durableWrite(join(ROOT,path),bytes));
}
const verdict=portal.decideReadiness({policy,ceremonyReceipt:base.importReceipt,replacementCertificates:[replacementCertificate],decidedAt:at('2026-07-23T04:10:00Z')});
verifyIntakeReadinessVerdictV33_50({verdict,policy,ceremonyReceipt:base.importReceipt,receipts,replacementCertificates:[replacementCertificate],trust,verifiedAt:at('2026-07-23T04:11:00Z')});
durableWrites.push(durableWrite(join(ROOT,'readiness-verdict.json'),jsonBytes(verdict)),durableWrite(join(ROOT,'replacement-certificate.json'),jsonBytes(replacementCertificate)));
const attack=(fn)=>{try{fn();return false;}catch{return true;}};
const attacks={
  malwareBlocked:attack(()=>{const bytes=Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');const r={path:'bad.json',mediaType:'application/json',byteLength:bytes.byteLength,sha256:sha256Bytes(bytes)};const s=createRoleEvidenceSubmissionV33_50({roleSigner:transportIds[0],actor:base.responses[0].payload.actor,policy,channel:channels[0],enrollmentResponse:base.responses[0],executionClass:'LOCAL_REHEARSAL',files:[r],submittedAt:at('2026-07-23T04:12:00Z')});const scan=createIntakeMalwareScanV33_50({scannerSigner:scanner,scannerActor,policy,submission:s,fileBytes:{'bad.json':bytes},scannerEngine:'BUILTIN_STATIC_V33_50',scannedAt:at('2026-07-23T04:13:00Z')});new CeremonyEvidenceIntakePortalV33_50(trust,portalSigner,readiness).intake({policy,ceremonyReceipt:base.importReceipt,channel:channels[0],enrollmentResponse:base.responses[0],submission:s,scan,fileBytes:{'bad.json':bytes},acceptedAt:at('2026-07-23T04:14:00Z')});}),
  channelReplayBlocked:attack(()=>{const p=new CeremonyEvidenceIntakePortalV33_50(trust,portalSigner,readiness);const b=artifactBytesByRole[0];const bytes=Buffer.from(b.bytesBase64,'base64');p.intake({policy,ceremonyReceipt:base.importReceipt,channel:channels[0],enrollmentResponse:base.responses[0],submission:submissions[0],scan:scans[0],fileBytes:{[b.path]:bytes},acceptedAt:at('2026-07-23T04:08:00Z')});const changed={...submissions[0].payload,submittedAt:'2026-07-23T04:09:00.000Z'};delete changed.submissionDigest;const altered=signEnvelope({...changed,submissionDigest:sha256(changed)},transportIds[0]);p.intake({policy,ceremonyReceipt:base.importReceipt,channel:channels[0],enrollmentResponse:base.responses[0],submission:altered,scan:scans[0],fileBytes:{[b.path]:bytes},acceptedAt:at('2026-07-23T04:09:30Z')});}),
  unauthorizedRosterBlocked:attack(()=>{const fakeActor=actor(transportIds[0],'fake-roster');const m={...base.responses[0].payload,actor:fakeActor,respondedAt:'2026-07-23T04:00:00.000Z'};delete m.responseDigest;const fake=signEnvelope({...m,responseDigest:sha256(m)},transportIds[0]);const b=artifactBytesByRole[0];const bytes=Buffer.from(b.bytesBase64,'base64');new CeremonyEvidenceIntakePortalV33_50(trust,portalSigner,readiness).intake({policy,ceremonyReceipt:base.importReceipt,channel:channels[0],enrollmentResponse:fake,submission:submissions[0],scan:scans[0],fileBytes:{[b.path]:bytes},acceptedAt:at('2026-07-23T04:08:00Z')});}),
  externalRelabelBlocked:attack(()=>{const mutated={...verdict.payload,status:'EXTERNAL_CEREMONY_EVIDENCE_READY_FOR_IMPORT',externalCeremonyObserved:true};delete mutated.verdictDigest;const bad=signEnvelope({...mutated,verdictDigest:sha256(mutated)},readiness);verifyIntakeReadinessVerdictV33_50({verdict:bad,policy,ceremonyReceipt:base.importReceipt,receipts,replacementCertificates:[replacementCertificate],trust,verifiedAt:at('2026-07-23T04:11:00Z')});}),
  missingRoleBlocked:attack(()=>verifyIntakeReadinessVerdictV33_50({verdict,policy,ceremonyReceipt:base.importReceipt,receipts:receipts.slice(0,-1),replacementCertificates:[replacementCertificate],trust,verifiedAt:at('2026-07-23T04:11:00Z')})),
  replacementBelowQuorumBlocked:attack(()=>createRoleReplacementCertificateV33_50({authority:replacementAuthority,policy,role:originalResponse.payload.role,ordinal:originalResponse.payload.ordinal,replacedActor:originalResponse.payload.actor,replacementActor,approvals:replacementApprovals.slice(0,2),reasonCode:'ROLE_HOLDER_UNAVAILABLE',issuedAt:at('2026-07-23T04:03:00Z'),expiresAt:at('2026-07-23T05:30:00Z'),trust})),
  untrustedScannerBlocked:attack(()=>{const bad={...scans[0].payload,scannerEngine:'EXTERNAL_QUALIFIED_SCANNER',externalScannerAttestationDigest:sha256({unknown:1}),status:'EXTERNAL_QUALIFIED_CLEAN'};delete bad.scanDigest;const signed=signEnvelope({...bad,scanDigest:sha256(bad)},scanner);const ext={...submissions[0].payload,executionClass:'LIVE_EXTERNAL',externalAttestationDigests:[externalAttestations[0]]};delete ext.submissionDigest;const sub=signEnvelope({...ext,submissionDigest:sha256(ext)},transportIds[0]);const b=artifactBytesByRole[0];new CeremonyEvidenceIntakePortalV33_50(trust,portalSigner,readiness).intake({policy,ceremonyReceipt:base.importReceipt,channel:channels[0],enrollmentResponse:base.responses[0],submission:sub,scan:signed,fileBytes:{[b.path]:Buffer.from(b.bytesBase64,'base64')},acceptedAt:at('2026-07-23T04:08:00Z')});}),
};
const newIdentities=[policySigner,portalSigner,scanner,readiness,replacementAuthority,...custodians,...transportIds,replacementTransport];
const proof={version:'33.50',generatedAt:new Date().toISOString(),base:{proofPath:relative(process.cwd(),BASE),proofSha256:sha256Bytes(readFileSync(BASE)),ceremonyReceipt:base.importReceipt,enrollmentResponseDigests:base.responses.map(x=>x.payload.responseDigest)},publicKeys:[...base.publicKeys,...newIdentities.map(exportKey)],trustedIds:{policy:[policySigner.keyId],portal:[portalSigner.keyId],baseRoles:base.trustedIds.roles,transports:[...transportIds.map(x=>x.keyId),replacementTransport.keyId],scanner:[scanner.keyId],readiness:[readiness.keyId],replacementCustodians:custodians.map(x=>x.keyId),replacementAuthority:[replacementAuthority.keyId]},policy,channels,submissions,scans,receipts,replacementApprovals,replacementCertificate,verdict,artifactBytesByRole,executionEvidence:{root:relative(process.cwd(),ROOT),durableWrites,roleDirectoryCount:16,quarantinedFileCount:16},attacks,summary:{newSignatureCount:70,totalChainSignatureCount:232,roleCount:16,channelCount:16,submissionCount:16,scanCount:16,receiptCount:16,replacementApprovalCount:3,replacementCertificateCount:1,externalAttestationCount:0,externallyQualifiedScanCount:0,durableWriteCount:durableWrites.length},truthBoundary:{status:'LOCAL_CEREMONY_EVIDENCE_INTAKE_REHEARSAL_ONLY',externalCeremonyObserved:false,externalHostsObserved:0,externalClockRootsObserved:0,externalStoresObserved:0,externalInfrastructureAttestations:0,externalHumanParticipants:0,productionAuthority:'NONE',externalEffectsExecuted:0,g3:'blocked',productionPromotion:'blocked'}};
mkdirSync(dirname(OUT),{recursive:true});writeFileSync(OUT,JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({status:verdict.payload.status,newSignatures:proof.summary.newSignatureCount,totalSignatures:proof.summary.totalChainSignatureCount,roles:proof.summary.roleCount,durableWrites:proof.summary.durableWriteCount,attacks:Object.values(attacks).filter(Boolean).length,output:OUT},null,2));
