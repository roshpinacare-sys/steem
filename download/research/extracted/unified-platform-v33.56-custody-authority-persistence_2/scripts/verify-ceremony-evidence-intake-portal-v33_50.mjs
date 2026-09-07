import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KeyRegistry, generateSigningIdentity, sha256Bytes } from '../dist/src/contracts/crypto.js';
import {
  CeremonyEvidenceIntakePortalV33_50,
  verifyIntakeReadinessVerdictV33_50,
  verifyRoleReplacementCertificateV33_50,
} from '../dist/src/supply-chain/ceremony-evidence-intake-portal-v33_50.js';

const input=resolve(process.argv[2]??'release-evidence/v33.50/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL_PROOF.json');
const output=resolve(process.argv[3]??'release-evidence/v33.50/V33_50_INDEPENDENT_VERIFICATION.json');
const proof=JSON.parse(readFileSync(input,'utf8'));
const baseOut=resolve('release-evidence/v33.50/.tmp-v33.49-verification.json');
const run=spawnSync(process.execPath,['scripts/verify-external-ceremony-executor-v33_49.mjs',proof.base.proofPath,baseOut],{encoding:'utf8'});
if(run.status!==0)throw new Error(`base_verifier_failed:${run.stderr}`);
const baseVerification=JSON.parse(readFileSync(baseOut,'utf8'));rmSync(baseOut,{force:true});
const keyMap=new Map(proof.publicKeys.map(x=>[x.keyId,x]));
const subset=(ids)=>{const r=new KeyRegistry();for(const id of ids){const x=keyMap.get(id);if(!x)throw new Error(`missing_key:${id}`);r.registerExported(x);}return r;};
const roleIds=[...proof.trustedIds.baseRoles,...proof.trustedIds.transports];
const trust={policyRegistry:subset(proof.trustedIds.policy),trustedPolicySignerIds:proof.trustedIds.policy,portalRegistry:subset(proof.trustedIds.portal),trustedPortalSignerIds:proof.trustedIds.portal,roleRegistry:subset(roleIds),trustedRoleSignerIds:roleIds,scannerRegistry:subset(proof.trustedIds.scanner),trustedScannerSignerIds:proof.trustedIds.scanner,replacementCustodianRegistry:subset(proof.trustedIds.replacementCustodians),trustedReplacementCustodianIds:proof.trustedIds.replacementCustodians,replacementAuthorityRegistry:subset(proof.trustedIds.replacementAuthority),trustedReplacementAuthorityIds:proof.trustedIds.replacementAuthority,readinessRegistry:subset(proof.trustedIds.readiness),trustedReadinessSignerIds:proof.trustedIds.readiness,trustedExternalAttestationDigests:[],trustedExternalScannerAttestationDigests:[]};
const verifiedAt=new Date(proof.verdict.payload.decidedAt);
verifyRoleReplacementCertificateV33_50({policy:proof.policy,certificate:proof.replacementCertificate,approvals:proof.replacementApprovals,trust,verifiedAt});
const dummyPortal=generateSigningIdentity('v3350-independent-dummy-portal');
const dummyReadiness=generateSigningIdentity('v3350-independent-dummy-readiness');
const portalRegistry=subset(proof.trustedIds.portal);portalRegistry.register(dummyPortal.keyId,dummyPortal.publicKey);
const readinessRegistry=subset(proof.trustedIds.readiness);readinessRegistry.register(dummyReadiness.keyId,dummyReadiness.publicKey);
const recomputeTrust={...trust,portalRegistry,trustedPortalSignerIds:[...trust.trustedPortalSignerIds,dummyPortal.keyId],readinessRegistry,trustedReadinessSignerIds:[...trust.trustedReadinessSignerIds,dummyReadiness.keyId]};
const portal=new CeremonyEvidenceIntakePortalV33_50(recomputeTrust,dummyPortal,dummyReadiness);
const artifactBytesByPath=new Map(proof.artifactBytesByRole.map(x=>[x.path,Buffer.from(x.bytesBase64,'base64')]));
const recomputedReceiptDigests=[];
for(let i=0;i<16;i++){
  const submission=proof.submissions[i];
  const fileBytes=Object.fromEntries(submission.payload.files.map(f=>[f.path,artifactBytesByPath.get(f.path)]));
  const result=portal.intake({policy:proof.policy,ceremonyReceipt:proof.base.ceremonyReceipt,channel:proof.channels[i],enrollmentResponse:JSON.parse(readFileSync(proof.base.proofPath,'utf8')).responses[i],submission,scan:proof.scans[i],fileBytes,acceptedAt:new Date(proof.receipts[i].payload.acceptedAt),...(i===15?{replacementCertificate:proof.replacementCertificate}:{})});
  recomputedReceiptDigests.push(result.payload.receiptDigest);
}
const recomputedVerdict=portal.decideReadiness({policy:proof.policy,ceremonyReceipt:proof.base.ceremonyReceipt,replacementCertificates:[proof.replacementCertificate],decidedAt:verifiedAt});
const independentVerdict=verifyIntakeReadinessVerdictV33_50({verdict:proof.verdict,policy:proof.policy,ceremonyReceipt:proof.base.ceremonyReceipt,receipts:proof.receipts,replacementCertificates:[proof.replacementCertificate],trust,verifiedAt});
const all=subset(proof.publicKeys.map(x=>x.keyId));
const envelopes=[proof.policy,...proof.channels,...proof.submissions,...proof.scans,...proof.receipts,...proof.replacementApprovals,proof.replacementCertificate,proof.verdict];
const root=resolve(proof.executionEvidence.root);
const durable=proof.executionEvidence.durableWrites.every(x=>{const b=readFileSync(join(root,x.path));return x.fileFsync&&x.directoryFsync&&x.rereadVerified&&b.byteLength===x.byteLength&&sha256Bytes(b)===x.sha256;});
const baseProof=JSON.parse(readFileSync(proof.base.proofPath,'utf8'));
const checks={
  version:proof.version==='33.50',
  baseProofDigest:sha256Bytes(readFileSync(proof.base.proofPath))===proof.base.proofSha256,
  baseVerifierPassed:baseVerification.status==='PASS',
  baseReceiptDigest:proof.base.ceremonyReceipt.receiptDigest===baseProof.importReceipt.receiptDigest,
  authorizedRoster:proof.policy.payload.authorizedEnrollmentResponseDigests.length===16&&JSON.stringify(proof.policy.payload.authorizedEnrollmentResponseDigests)===JSON.stringify(baseProof.responses.map(x=>x.payload.responseDigest).sort()),
  newSignaturesValid:envelopes.length===70&&envelopes.every(e=>all.verifyAt(e,verifiedAt)),
  newSignatureCount:proof.summary.newSignatureCount===70,
  totalChainSignatureCount:proof.summary.totalChainSignatureCount===232,
  replacementRecomputed:true,
  receiptPayloadsRecomputed:JSON.stringify(recomputedReceiptDigests.sort())===JSON.stringify(proof.receipts.map(x=>x.payload.receiptDigest).sort()),
  verdictPayloadRecomputed:recomputedVerdict.payload.verdictDigest===proof.verdict.payload.verdictDigest&&independentVerdict.verdictDigest===proof.verdict.payload.verdictDigest,
  exactRoleCount:proof.receipts.length===16&&proof.channels.length===16&&proof.submissions.length===16&&proof.scans.length===16,
  exactQuarantineInventory:proof.artifactBytesByRole.length===16&&proof.artifactBytesByRole.every(x=>artifactBytesByPath.get(x.path)?.byteLength>0),
  durableWrites:durable&&proof.executionEvidence.durableWrites.length===82,
  attacks:Object.values(proof.attacks).every(Boolean),
  truthBoundary:proof.truthBoundary.status==='LOCAL_CEREMONY_EVIDENCE_INTAKE_REHEARSAL_ONLY'&&!proof.truthBoundary.externalCeremonyObserved&&proof.truthBoundary.externalHostsObserved===0&&proof.truthBoundary.externalClockRootsObserved===0&&proof.truthBoundary.externalStoresObserved===0&&proof.truthBoundary.externalInfrastructureAttestations===0&&proof.truthBoundary.externalHumanParticipants===0&&proof.truthBoundary.productionAuthority==='NONE'&&proof.truthBoundary.externalEffectsExecuted===0,
};
const status=Object.values(checks).every(Boolean)?'PASS':'FAIL';
const result={version:'33.50',generatedAt:new Date().toISOString(),status,newSignatureCount:70,totalChainSignatureCount:232,roleCount:proof.receipts.length,channelCount:proof.channels.length,quarantineReceiptCount:proof.receipts.length,replacementApprovalCount:proof.replacementApprovals.length,durableWriteCount:proof.executionEvidence.durableWrites.length,finalStatus:proof.verdict.payload.status,productionAuthority:proof.verdict.payload.productionAuthority,checks};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(status!=='PASS')process.exit(1);
