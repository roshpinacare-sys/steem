import { readFileSync } from 'node:fs';
import { KeyRegistry, generateSigningIdentity, sha256 } from '../dist/src/contracts/crypto.js';
import { decodeOfflineEvidencePackageV33_23, verifyOfflineEvidencePackageV33_23 } from '../dist/src/app/evidence-intake-portal-v33_23.js';

const [packagePath, policyPath] = process.argv.slice(2);
if (!packagePath || !policyPath) { console.error('usage: verify-offline-evidence-package-v33_23.mjs PACKAGE.json TRUST-POLICY.json'); process.exit(2); }
const encoded = JSON.parse(readFileSync(packagePath,'utf8'));
const policy = JSON.parse(readFileSync(policyPath,'utf8'));
const errors=[];
if (policy.version!=='33.23' || policy.productionAuthority!=='NONE' || policy.syntheticEvidenceAcceptedForExternalQualification!==false || policy.externalMalwareScanRequired!==true) errors.push('trust_policy_boundary_invalid');
const pkg=decodeOfflineEvidencePackageV33_23(encoded);
const roleIds={session:pkg.session.issuerKeyId,challenge:pkg.challenge.issuerKeyId,operator:pkg.bundle.issuerKeyId,scanner:pkg.scanReport.issuerKeyId,portal:pkg.intakeReceipt.issuerKeyId,exporter:pkg.manifest.issuerKeyId};
const byId=new Map(pkg.publicKeys.map((record)=>[record.keyId,record]));
for(const [role,keyId] of Object.entries(roleIds)){
 const expected=policy.roles?.[role]; const actual=byId.get(keyId);
 if(!expected||expected.keyId!==keyId||!actual||expected.fingerprint!==actual.fingerprint||actual.revoked) errors.push(`trust_pin_invalid:${role}`);
}
if(new Set(Object.values(roleIds)).size!==Object.values(roleIds).length)errors.push('package_role_separation_invalid');
if(errors.length){console.log(JSON.stringify({version:'33.23',status:'failed',errors,networkAccessAttempted:false,productionAuthority:'NONE'},null,2));process.exit(1);}
function one(record){const r=new KeyRegistry();r.registerExported(record);return r;}
const verifier=generateSigningIdentity('offline-verifier-ephemeral-local');
const verifierRegistry=new KeyRegistry();verifierRegistry.register(verifier.keyId,verifier.publicKey);
const trust={
 sessionRegistry:one(byId.get(roleIds.session)),trustedSessionSignerIds:[roleIds.session],
 challengeRegistry:one(byId.get(roleIds.challenge)),trustedChallengeSignerIds:[roleIds.challenge],
 operatorRegistry:one(byId.get(roleIds.operator)),trustedOperatorSignerIds:[roleIds.operator],
 scannerRegistry:one(byId.get(roleIds.scanner)),trustedScannerSignerIds:[roleIds.scanner],
 portalRegistry:one(byId.get(roleIds.portal)),trustedPortalSignerIds:[roleIds.portal],
 exporterRegistry:one(byId.get(roleIds.exporter)),trustedExporterSignerIds:[roleIds.exporter],
 verifierRegistry,trustedVerifierSignerIds:[verifier.keyId],
};
let verdict;
try{verdict=verifyOfflineEvidencePackageV33_23({package:pkg,trust,verifier,now:new Date(pkg.manifest.payload.exportedAt)});}catch(error){console.log(JSON.stringify({version:'33.23',status:'failed',errors:[error instanceof Error?error.message:'offline_verification_failed'],networkAccessAttempted:false,productionAuthority:'NONE'},null,2));process.exit(1);}
const reportMaterial={version:'33.23',status:'passed',packageId:pkg.manifest.payload.packageId,packageDigest:pkg.manifest.payload.packageDigest,trustPolicyDigest:sha256(policy),verdictStatus:verdict.payload.status,artifactCount:verdict.payload.artifactCount,artifactBytesVerified:verdict.payload.artifactBytesVerified,builtinScanVerified:verdict.payload.builtinScanVerified,externalMalwareScanStillRequired:true,networkAccessAttempted:false,ephemeralLocalVerifier:true,qualificationAuthority:false,productionAuthority:'NONE'};
console.log(JSON.stringify({...reportMaterial,reportDigest:sha256(reportMaterial)},null,2));
