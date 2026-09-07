import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { KeyRegistry, sha256, sha256Bytes } from '../dist/src/contracts/crypto.js';
import { decodeOfflineEvidencePackageV33_23 } from '../dist/src/app/evidence-intake-portal-v33_23.js';
const base='release-evidence/v33.23';
const load=(name)=>JSON.parse(readFileSync(`${base}/${name}`,'utf8'));
const keys=load('V33_23_PROOF_PUBLIC_KEYS.json'); const registry=new KeyRegistry(); for(const key of keys.keys) registry.registerExported(key);
const proof=load('V33_23_SIGNED_EVIDENCE_INTAKE_PROOF.json');
const trace=load('V33_23_INTAKE_TRACE.json');
const snapshot=load('V33_23_QUARANTINE_SNAPSHOT.json');
const scans=load('V33_23_SCAN_REPORTS.json');
const receipts=load('V33_23_INTAKE_RECEIPTS.json');
const encoded=load('V33_23_OFFLINE_PACKAGE.json');
const policy=load('V33_23_PINNED_TRUST_POLICY.json');
const verdict=load('V33_23_OFFLINE_VERIFICATION_VERDICT.json');
const cliReport=load('V33_23_OFFLINE_VERIFIER_REPORT.json');
const probe=load('V33_23_PORTAL_PROBE.json');
const kit=load('V33_23_EXTERNAL_OPERATOR_KIT_MANIFEST.json');
const errors=[];
const verify=(envelope,label)=>{if(!registry.verify(envelope))errors.push(`signature_invalid:${label}:${envelope?.issuerKeyId}`);};
verify(proof,'proof'); verify(trace,'trace'); verify(verdict,'offline-verdict');
for(const [i,x] of scans.entries())verify(x,`scan-${i}`); for(const [i,x] of receipts.entries())verify(x,`receipt-${i}`);
for(const [i,r] of snapshot.records.entries()) { verify(r.session,`session-${i}`);verify(r.challenge,`challenge-${i}`);verify(r.bundle,`bundle-${i}`);verify(r.scanReport,`record-scan-${i}`);verify(r.intakeReceipt,`record-receipt-${i}`); }
verify(encoded.manifest,'offline-manifest'); verify(encoded.session,'offline-session'); verify(encoded.challenge,'offline-challenge'); verify(encoded.bundle,'offline-bundle'); verify(encoded.scanReport,'offline-scan'); verify(encoded.intakeReceipt,'offline-receipt');
const digest=(payload,key)=>{const {[key]:expected,...material}=payload;return sha256(material)===expected;};
for(const [payload,key,label] of [[proof.payload,'proofDigest','proof'],[trace.payload,'traceDigest','trace'],[verdict.payload,'verdictDigest','verdict']]) if(!digest(payload,key))errors.push(`digest_invalid:${label}`);
for(const [i,x] of scans.entries())if(!digest(x.payload,'reportDigest'))errors.push(`scan_digest_invalid:${i}`);
for(const [i,x] of receipts.entries())if(!digest(x.payload,'receiptDigest'))errors.push(`receipt_digest_invalid:${i}`);
if(!digest(encoded.manifest.payload,'packageDigest'))errors.push('offline_manifest_digest_invalid');
if(!digest(snapshot,'snapshotDigest'))errors.push('snapshot_digest_invalid');
let previous=sha256('evidence-intake-quarantine-genesis-v33.23');
for(let i=0;i<snapshot.events.length;i++){const event=snapshot.events[i];if(event.sequence!==i+1||event.previousEventDigest!==previous||!digest(event,'eventDigest'))errors.push(`event_chain_invalid:${i}`);previous=event.eventDigest;}
if(snapshot.records.length!==2||snapshot.events.length!==2||snapshot.productionAuthority!=='NONE'||snapshot.externalEffectsExecuted!==0)errors.push('snapshot_boundary_invalid');
const statusSet=new Set(scans.map(x=>x.payload.status));
if(!statusSet.has('BUILTIN_SCAN_PASSED')||!statusSet.has('REJECTED')||scans.reduce((n,x)=>n+x.payload.findingCount,0)<1)errors.push('scan_campaign_invalid');
for(const x of scans){if(x.payload.externalMalwareQualification!=='EXTERNAL_MALWARE_SCAN_REQUIRED'||x.payload.productionAuthority!=='NONE'||x.payload.externalEffectsExecuted!==0)errors.push('scan_boundary_invalid');}
if(receipts.length!==2||receipts.filter(x=>x.payload.eligibleForOfflineVerification).length!==1||receipts.some(x=>x.payload.eligibleForExternalQualification!==false))errors.push('receipt_boundary_invalid');
if(proof.payload.status!=='SIGNED_EVIDENCE_INTAKE_AND_OFFLINE_VERIFIER_PROVEN_LOCALLY'||proof.payload.evidenceClass!=='LOCAL_LOOPBACK_QUARANTINE_AND_OFFLINE_VERIFICATION'||proof.payload.cleanBundleCount!==1||proof.payload.rejectedBundleCount!==1||proof.payload.artifactCount!==12||proof.payload.externalMalwareScannerExecuted!==false||proof.payload.externalMalwareScanRequired!==true||proof.payload.publicIngressConfigured!==false||proof.payload.automaticArchiveExtraction!==false||proof.payload.liveExternalEvidenceImported!==0||proof.payload.externalEffectsExecuted!==0||proof.payload.productionAuthority!=='NONE'||proof.payload.productionPromotion!=='blocked')errors.push('proof_boundary_invalid');
if(verdict.payload.status!=='OFFLINE_VERIFIED_SYNTHETIC_NOT_EXTERNAL'||verdict.payload.eligibleForExternalQualification!==false||verdict.payload.networkAccessAttempted!==false||verdict.payload.externalMalwareScanStillRequired!==true||verdict.payload.productionAuthority!=='NONE')errors.push('verdict_boundary_invalid');
if(cliReport.status!=='passed'||cliReport.networkAccessAttempted!==false||cliReport.ephemeralLocalVerifier!==true||cliReport.qualificationAuthority!==false||cliReport.productionAuthority!=='NONE')errors.push('offline_cli_boundary_invalid');
if(probe.bindAddress!=='127.0.0.1'||probe.loopbackRoundTrip!==true||probe.publicIngressConfigured!==false||probe.automaticArchiveExtraction!==false||probe.externalEffectsExecuted!==0)errors.push('portal_probe_invalid');
if(policy.syntheticEvidenceAcceptedForExternalQualification!==false||policy.externalMalwareScanRequired!==true||policy.productionAuthority!=='NONE')errors.push('trust_policy_invalid');
if(kit.files.length!==8||kit.credentialsEmbedded!==false||kit.privateKeysEmbedded!==false||kit.publicIngressConfigured!==false||kit.automaticArchiveExtraction!==false||kit.externalMalwareScannerExecuted!==false||kit.productionAuthority!=='NONE'||kit.externalEffectsExecuted!==0)errors.push('operator_kit_boundary_invalid');
for(const file of kit.files){if(!statSync(file.path).isFile()||statSync(file.path).size!==file.sizeBytes||sha256Bytes(readFileSync(file.path))!==file.sha256)errors.push(`operator_kit_file_invalid:${file.path}`);}
try{const pkg=decodeOfflineEvidencePackageV33_23(encoded);if(Object.keys(pkg.artifactBytesByPath).length!==6)errors.push('offline_artifact_count_invalid');}catch(e){errors.push(`offline_decode_failed:${e instanceof Error?e.message:'unknown'}`);}
const cli=spawnSync('node',['scripts/verify-offline-evidence-package-v33_23.mjs',`${base}/V33_23_OFFLINE_PACKAGE.json`,`${base}/V33_23_PINNED_TRUST_POLICY.json`],{encoding:'utf8',timeout:90000});
if(cli.status!==0)errors.push(`offline_cli_failed:${(cli.stderr||cli.stdout||'').slice(-400)}`);else{try{const out=JSON.parse(cli.stdout);if(out.status!=='passed'||out.networkAccessAttempted!==false||out.qualificationAuthority!==false)errors.push('offline_cli_result_invalid');}catch{errors.push('offline_cli_json_invalid');}}
const result={version:'33.23',status:errors.length===0?'passed':'failed',errors,proofStatus:proof.payload.status,offlineVerdict:verdict.payload.status,externalMalwareScanRequired:true,liveExternalEvidenceImported:0,externalEffectsExecuted:0,productionAuthority:'NONE',productionPromotion:'blocked'};
console.log(JSON.stringify(result,null,2));if(errors.length)process.exit(1);
