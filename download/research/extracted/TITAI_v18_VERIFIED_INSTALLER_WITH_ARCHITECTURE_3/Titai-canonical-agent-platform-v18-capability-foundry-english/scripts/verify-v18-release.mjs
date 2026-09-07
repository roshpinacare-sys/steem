import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args=Object.fromEntries(process.argv.slice(2).flatMap((v,i,a)=>v.startsWith('--')?[[v.slice(2),a[i+1]]]:[]));
if(!args.zip||!args.out){console.error('Usage: node scripts/verify-v18-release.mjs --zip <zip> --out <json>');process.exit(2);}
const zip=path.resolve(args.zip), out=path.resolve(args.out);const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>JSON.stringify(Array.isArray(v)?v.map(norm):norm(v));function norm(v){if(Array.isArray(v))return v.map(norm);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,norm(x)]));return v;}
const temp=await mkdtemp(path.join(tmpdir(),'titai-v18-verifier-'));
let decision='REJECTED',reason='verification_error',details={};
try{
 const unzip=spawnSync('unzip',['-q',zip,'-d',temp],{encoding:'utf8'});if(unzip.status!==0)throw new Error(`unzip_failed:${unzip.stderr}`);
 const entries=await readdir(temp,{withFileTypes:true});const releaseRoot=entries.length===1&&entries[0].isDirectory()?path.join(temp,entries[0].name):temp;
 const manifestPath=path.join(releaseRoot,'docs/roast/RELEASE_MANIFEST.json');const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 const mismatches=[];for(const f of manifest.files){const p=path.join(releaseRoot,f.path);try{const b=await readFile(p);const s=await stat(p);if(s.size!==f.bytes||hash(b)!==f.sha256)mismatches.push(f.path);}catch{mismatches.push(f.path);}}
 const validation=JSON.parse(await readFile(path.join(releaseRoot,'docs/canonical/evidence/v18/validation.json'),'utf8'));
 const pkgDir=path.join(releaseRoot,'docs/canonical/evidence/v18/packages/titai-local-document-toolpack-1.0.0');
 const cap=JSON.parse(await readFile(path.join(pkgDir,'CAPABILITY_MANIFEST.json'),'utf8'));const trust=JSON.parse(await readFile(path.join(pkgDir,'PUBLISHER_TRUST.json'),'utf8'));
 const {signature,...unsigned}=cap;const signatureValid=verify(null,Buffer.from(canonical(unsigned)),trust.publicKeyPem,Buffer.from(signature.value,'base64'));
 const fileMismatches=[];for(const f of cap.files){try{const b=await readFile(path.join(pkgDir,f.path));if(b.length!==f.sizeBytes||hash(b)!==f.sha256)fileMismatches.push(f.path);}catch{fileMismatches.push(f.path);}}
 const foundry=JSON.parse(await readFile(path.join(releaseRoot,'docs/canonical/evidence/v18/V18_CAPABILITY_FOUNDRY_EVIDENCE.json'),'utf8'));
 const slicesPassed=Object.values(foundry.verticalSlices??{}).length===5&&Object.values(foundry.verticalSlices).every(v=>v==='passed');
 const softwareAccepted=validation.summary?.softwareGatesPassed===true&&validation.fullTests?.failedFiles===0&&validation.fullTests?.timedOutFiles===0&&signatureValid&&fileMismatches.length===0&&mismatches.length===0&&slicesPassed;
 decision=softwareAccepted?'ACCEPTED':'REJECTED';reason=softwareAccepted?'capability_foundry_pilot_gates_passed':'software_gate_failed';
 details={manifestFileCount:manifest.files.length,manifestMismatches:mismatches,capabilitySignatureValid:signatureValid,capabilityFileMismatches:fileMismatches,verticalSlices:foundry.verticalSlices,softwareGatesPassed:validation.summary?.softwareGatesPassed,physicalBlockers:validation.physicalBlockers??[]};
 const zipSha256=hash(await readFile(zip));const pair=generateKeyPairSync('ed25519');const verifierPublicKey=pair.publicKey.export({type:'spki',format:'pem'}).toString();
 const unsignedAtt={schemaVersion:'titai.v18.verifier-attestation.v1',generatedAt:new Date().toISOString(),verifier:{identity:`verifier-${hash(verifierPublicKey).slice(0,16)}`,execution:'separate-process-evidence-only',publicKeyPem:verifierPublicKey},release:{zip:path.basename(zip),sha256:zipSha256,manifestSha256:hash(await readFile(manifestPath))},decision,reason,classifications:{completeSovereignty:'SOVEREIGN DEVELOPMENT MODE',completeRelease:'DEVELOPMENT ONLY',capabilityFoundry:softwareAccepted?'CONTROLLED CAPABILITY PILOT':'QUALIFIED DEVELOPMENT SYSTEM'},details,limitations:['Verifier ran in a separate process but not on an external physical host.','Physical v17/v18 gates remain blocked and are not promoted by subsystem acceptance.']};
 const sig=sign(null,Buffer.from(canonical(unsignedAtt)),pair.privateKey).toString('base64');const att={...unsignedAtt,signature:{algorithm:'Ed25519',value:sig}};att.signatureValidation=verify(null,Buffer.from(canonical(unsignedAtt)),verifierPublicKey,Buffer.from(sig,'base64'));
 await writeFile(out,JSON.stringify(att,null,2)+'\n');console.log(JSON.stringify({decision,classifications:att.classifications,signatureValid:att.signatureValidation,zipSha256},null,2));if(!softwareAccepted)process.exitCode=1;
}finally{await rm(temp,{recursive:true,force:true});}
