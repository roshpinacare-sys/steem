#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { evaluateExternalQualificationGate } from '../dist/src/qualification/external-qualification-gate.js';
import { evaluateHsmKmsQualification } from '../dist/src/qualification/hsm-kms-qualification.js';
import { evaluateHumanPilotQualification } from '../dist/src/qualification/human-pilot-qualification.js';
import { evaluateIndependentReviewQualification } from '../dist/src/qualification/independent-review-qualification.js';
import { evaluateMonotonicWitnessQualification } from '../dist/src/qualification/monotonic-witness-qualification.js';
import { evaluateMultiHostSloQualification } from '../dist/src/qualification/multi-host-slo-qualification.js';
import { evaluatePostgresHaQualification } from '../dist/src/qualification/postgres-ha-qualification.js';

const root=resolve(import.meta.dirname,'..'); const out=join(root,'evidence/generated'); mkdirSync(out,{recursive:true});
const inputDir=resolve(process.argv[2]??process.env.V32_3_EXTERNAL_EVIDENCE_DIR??join(root,'external-evidence'));
const manifest=JSON.parse(readFileSync(join(root,'external-qualification/qualification-manifest.json'),'utf8'));
const missing=manifest.gates.filter((gate)=>!existsSync(join(inputDir,gate.file))).map((gate)=>gate.file);
const sourceDigest=computeSourceDigest();
let report;
if(missing.length>0){
  report={version:'32.3',status:'NOT_EXECUTED',classification:'external-qualification-evidence-absent',sourceDigest,inputDirectory:inputDir,missingFiles:missing,passedGates:0,totalGates:6,productionPromotion:'blocked',limitations:['No external qualification claim is made from missing evidence.']};
}else{
  const load=(name)=>JSON.parse(readFileSync(join(inputDir,name),'utf8'));
  const evidence={hsmKms:load('hsm-kms.json'),witness:load('monotonic-witness.json'),postgres:load('postgres-ha-pitr.json'),humanPilot:load('human-pilot.json'),independentReview:load('independent-review.json'),multiHostSlo:load('multi-host-slo.json')};
  const results={
    hsmKms:bindSource(evaluateHsmKmsQualification(evidence.hsmKms),evidence.hsmKms,sourceDigest),
    witness:bindSource(evaluateMonotonicWitnessQualification(evidence.witness),evidence.witness,sourceDigest),
    postgres:bindSource(evaluatePostgresHaQualification(evidence.postgres),evidence.postgres,sourceDigest),
    humanPilot:bindSource(evaluateHumanPilotQualification(evidence.humanPilot),evidence.humanPilot,sourceDigest),
    independentReview:bindSource(evaluateIndependentReviewQualification(evidence.independentReview),evidence.independentReview,sourceDigest),
    multiHostSlo:bindSource(evaluateMultiHostSloQualification(evidence.multiHostSlo),evidence.multiHostSlo,sourceDigest),
  };
  const aggregate=evaluateExternalQualificationGate({sourceDigest,...results});
  report={version:'32.3',status:aggregate.status,classification:'observed-external-qualification-evaluation',sourceDigest,inputDirectory:inputDir,results,aggregate,productionPromotion:aggregate.productionPromotion,automaticPromotion:false,limitations:['Passing gates creates eligibility for an authorized decision only.']};
}
const path=join(out,'V32_3_EXTERNAL_QUALIFICATION.json'); writeFileSync(path,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,sourceDigest,missingFiles:report.missingFiles??[],productionPromotion:report.productionPromotion},null,2));
if(report.status==='BLOCKED') process.exitCode=1;

function bindSource(result,evidence,expected){
  if(evidence?.envelope?.sourceDigest===expected) return result;
  return {...result,status:'BLOCK',findings:[...result.findings,{code:'EVIDENCE_SOURCE_TREE_MISMATCH',message:'Evidence does not bind to the exact source digest.'}]};
}
function computeSourceDigest(){const h=createHash('sha256'); for(const item of ['CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','package.json','package-lock.json','tsconfig.json','src','tests','scripts','e2e','governance-state','infra','isolation','schemas','external-qualification','docs']){const p=join(root,item); if(!existsSync(p))continue; const files=statSync(p).isFile()?[p]:walk(p); for(const file of files){const rel=relative(root,file).replaceAll('\\','/'); if(rel.startsWith('evidence/')||rel.startsWith('dist/')||rel.startsWith('node_modules/')||rel.includes('__pycache__'))continue; h.update(rel);h.update('\0');h.update(readFileSync(file));h.update('\0');}} return h.digest('hex');}
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>{const p=join(dir,entry.name); return entry.isDirectory()?walk(p):[p];}).sort();}
