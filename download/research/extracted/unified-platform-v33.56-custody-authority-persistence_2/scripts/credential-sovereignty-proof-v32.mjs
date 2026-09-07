import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateSigningIdentity, KeyRegistry, sha256, signEnvelope,
} from '../dist/src/contracts/crypto.js';
import { CredentialIssuerTrustRegistry } from '../dist/src/security/credential-issuer-trust.js';
import { ReviewerTrustRegistry } from '../dist/src/security/reviewer-trust.js';
import { ProviderTrustRegistry } from '../dist/src/security/provider-trust.js';
import {
  createCredentialTrustBundle, credentialTrustBundleDigest,
  FileCredentialTrustAnchor, FileCredentialTrustBundleStore,
  verifyAndImportCredentialTrustBundle,
} from '../dist/src/platform/credential-trust-bundle.js';

const out = new URL('../evidence/generated/V32_CREDENTIAL_SOVEREIGNTY_PROOF.json', import.meta.url);
const t0 = new Date('2026-07-18T02:00:00.000Z');
const roots=[generateSigningIdentity('v32-proof-root-a'),generateSigningIdentity('v32-proof-root-b')];
const issuer=generateSigningIdentity('v32-proof-issuer');
const reviewer=generateSigningIdentity('v32-proof-reviewer');
const providerOld=generateSigningIdentity('v32-proof-provider-old');
const providerNew=generateSigningIdentity('v32-proof-provider-new');
const registry=new KeyRegistry(); for(const id of [...roots,issuer,reviewer,providerOld,providerNew])registry.register(id.keyId,id.publicKey);
const issuerTrust=new CredentialIssuerTrustRegistry(registry,new Set(roots.map(x=>x.keyId)));
const grant=signEnvelope({grantId:'v32-proof-grant',issuerKeyId:issuer.keyId,credentialKinds:['REVIEWER','PROVIDER'],tenantIds:['tenant-1'],scopes:['campaign.review','model.invoke'],issuedAt:new Date(t0-120000).toISOString(),expiresAt:new Date(t0.getTime()+600000).toISOString(),rootAuthorityId:roots[0].keyId},roots[0]);
issuerTrust.registerGrant(grant); const grantDigest=sha256(grant);
let clock=new Date(t0.getTime()-50000); const now=()=>clock;
const reviewerTrust=new ReviewerTrustRegistry(registry,issuerTrust,now);
const reviewerCred=signEnvelope({credentialId:'v32-proof-reviewer-1',reviewerKeyId:reviewer.keyId,organizationId:'org-independent-a',roles:['INDEPENDENT_REVIEWER'],tenantIds:['tenant-1'],scopes:['campaign.review'],issuedAt:new Date(t0-60000).toISOString(),expiresAt:new Date(t0.getTime()+300000).toISOString(),issuerId:issuer.keyId,issuerGrantDigest:grantDigest},issuer);
reviewerTrust.register(reviewerCred);
const providerTrust=new ProviderTrustRegistry(registry,issuerTrust,now);
const oldCred=signEnvelope({credentialId:'v32-proof-provider-old',providerId:'provider-a',providerKeyId:providerOld.keyId,allowedModels:['sol-5.6-qualified'],tenantIds:['tenant-1'],scopes:['model.invoke'],issuedAt:new Date(t0-60000).toISOString(),expiresAt:new Date(t0.getTime()+300000).toISOString(),issuerId:issuer.keyId,issuerGrantDigest:grantDigest},issuer);
providerTrust.register(oldCred); clock=new Date(t0.getTime()-20000);
const newCred=signEnvelope({...oldCred.payload,credentialId:'v32-proof-provider-new',providerKeyId:providerNew.keyId,issuedAt:new Date(t0-30000).toISOString()},issuer); providerTrust.register(newCred);
providerTrust.registerRevocation(signEnvelope({revocationId:'v32-proof-provider-old-revoke',providerId:'provider-a',credentialDigest:sha256(oldCred),reason:'rotation',revokedAt:new Date(t0-10000).toISOString(),issuerId:issuer.keyId},issuer));
const rootPolicy={trustedRootKeyIds:roots.map(x=>x.keyId),custodianIdsByRootKeyId:{[roots[0].keyId]:'custodian-a',[roots[1].keyId]:'custodian-b'},threshold:2};
const pins={fingerprints:new Map(roots.map(x=>[x.keyId,registry.fingerprint(x.keyId)])),custodianIds:new Map([[roots[0].keyId,'custodian-a'],[roots[1].keyId,'custodian-b']]),threshold:2};
const make=(id,generatedAt,predecessorBundleDigest)=>createCredentialTrustBundle({bundleId:id,generatedAt,...(predecessorBundleDigest?{predecessorBundleDigest}:{}),rootPolicy,rootSigners:roots,keyRegistry:registry,issuerTrust,reviewerTrust,providerTrust});
const first=make('v32-proof-bundle-1',t0.toISOString()); const firstDigest=credentialTrustBundleDigest(first);
const dir=mkdtempSync(join(tmpdir(),'v32-credential-proof-')); const path=join(dir,'trust.json'); const anchorPath=join(dir,'anchor.json');
const store=new FileCredentialTrustBundleStore(path,pins,new FileCredentialTrustAnchor(anchorPath)); store.save(first);
const second=make('v32-proof-bundle-2',new Date(t0.getTime()+10000).toISOString(),firstDigest); const secondDigest=store.save(second);
const imported=store.load();
const oldBlocked=(()=>{try{imported.providerTrust.authorize({providerId:'provider-a',providerKeyId:providerOld.keyId,model:'sol-5.6-qualified',tenantId:'tenant-1',at:t0.toISOString()});return false;}catch{return true;}})();
const newActive=(()=>{try{imported.providerTrust.authorize({providerId:'provider-a',providerKeyId:providerNew.keyId,model:'sol-5.6-qualified',tenantId:'tenant-1',at:t0.toISOString()});return true;}catch{return false;}})();
writeFileSync(path,JSON.stringify(first)+'\n'); const rollbackDetected=(()=>{try{new FileCredentialTrustBundleStore(path,pins,new FileCredentialTrustAnchor(anchorPath)).load();return false;}catch{return true;}})();
// Historical verification proof.
const historical=signEnvelope({evidence:'before-key-revocation'},issuer); registry.revokeAt(issuer.keyId,new Date(t0.getTime()+20000));
const historicalBefore=registry.verifyAt(historical,new Date(t0.getTime()+10000)); const blockedAfter=registry.verifyAt(historical,new Date(t0.getTime()+30000))===false;
// Root custodian independence proof.
const sameCustodianRejected=(()=>{try{createCredentialTrustBundle({bundleId:'same-custodian',generatedAt:new Date(t0.getTime()+20000).toISOString(),rootPolicy:{...rootPolicy,custodianIdsByRootKeyId:{[roots[0].keyId]:'one',[roots[1].keyId]:'one'}},rootSigners:roots,keyRegistry:registry,issuerTrust,reviewerTrust,providerTrust});return false;}catch{return true;}})();
const selfIssuanceRejected=(()=>{try{const rogue=generateSigningIdentity('v32-self-issuer');registry.register(rogue.keyId,rogue.publicKey);new ReviewerTrustRegistry(registry,issuerTrust,()=>t0).register(signEnvelope({credentialId:'self',reviewerKeyId:rogue.keyId,organizationId:'rogue',roles:['INDEPENDENT_REVIEWER'],tenantIds:['tenant-1'],scopes:['campaign.review'],issuedAt:new Date(t0-1000).toISOString(),expiresAt:new Date(t0.getTime()+10000).toISOString(),issuerId:rogue.keyId,issuerGrantDigest:grantDigest},rogue));return false;}catch{return true;}})();
const report={version:'32.0',status:[oldBlocked,newActive,rollbackDetected,historicalBefore,blockedAfter,sameCustodianRejected,selfIssuanceRejected,secondDigest===imported.bundleDigest].every(Boolean)?'passed':'failed',classification:'credential-sovereignty-local-proof-not-production-qualification',results:{selfIssuanceRejected,sameCustodianThresholdRejected:sameCustodianRejected,thresholdCustodians:2,oldProviderCredentialRevoked:oldBlocked,newProviderCredentialActive:newActive,offlineImportDigestMatches:secondDigest===imported.bundleDigest,independentAnchorRollbackDetected:rollbackDetected,historicalSignatureValidBeforeEffectiveRevocation:historicalBefore,signatureBlockedAfterEffectiveRevocation:blockedAfter,externalMutationsExecuted:0},claims:[
 {claim:'A registered public key may issue credentials',verdict:'REJECTED'},
 {claim:'Two root key IDs necessarily represent two independent authorities',verdict:'REJECTED'},
 {claim:'A predecessor chain alone prevents offline rollback',verdict:'DOWNGRADED'},
 {claim:'A local file anchor protects rollback of both bundle and anchor storage',verdict:'REJECTED'},
 {claim:'Threshold signatures prove credential truth',verdict:'REJECTED'},
 {claim:'Rotation, targeted revocation, offline import and single-store rollback detection are locally exercised',verdict:'PROVISIONALLY_ACCEPTED_LOCAL'},
 {claim:'Time-effective key revocation can preserve valid historical evidence while blocking later trust',verdict:'PROVISIONALLY_ACCEPTED_LOCAL'},
],limitations:['Signatures prove authorization and material binding, not truth or legal independence.','The independent file anchor detects rollback of the bundle store alone; joint rollback of bundle and anchor remains unprotected without external monotonic storage, HSM or federation.','The proof is single-host and uses local test keys; PostgreSQL, KMS/HSM, live provider and human value are not qualified.']};
await import('node:fs').then(({mkdirSync,writeFileSync})=>{mkdirSync(new URL('../evidence/generated/',import.meta.url),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n')});
console.log(JSON.stringify(report,null,2)); if(report.status!=='passed')process.exit(1);
