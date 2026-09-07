import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const out='docs/canonical/evidence/v18/validation.json';
const readJson=async(p,fallback=null)=>{try{return JSON.parse(await readFile(path.join(root,p),'utf8'));}catch{return fallback;}};
const hashFile=async(p)=>{const b=await readFile(path.join(root,p));return {path:p,bytes:(await stat(path.join(root,p))).size,sha256:createHash('sha256').update(b).digest('hex')};};
const gateNames=['canonical','english','lint','migrations','typecheck','v18-tests','v18-prove','v18-persistence','eval-baseline','durable-prove','mutation-v12','mutation-v13','roast-dynamic','roast-static','roast-validate','build','release-audit'];
const gates={};
for(const n of gateNames){const p=`docs/canonical/evidence/v18/gates/${n}.json`;const d=await readJson(p);gates[n]=d?{status:d.exitCode===0?'passed':'failed',...d,evidence:p}:{status:'missing',evidence:p};}
const tests=await readJson('docs/canonical/evidence/v18/full-tests/summary.json',{});
const foundry=await readJson('docs/canonical/evidence/v18/V18_CAPABILITY_FOUNDRY_EVIDENCE.json',{});
const persistence=await readJson('docs/canonical/evidence/v18/persistence-proof.json',{});
const roast=await readJson('docs/roast/ROAST_FINDINGS.json',{findings:[]});
const physicalBlockers=foundry.physicalGatesPreserved??[];
const requiredSoftware=['canonical','english','lint','migrations','typecheck','v18-tests','v18-prove','v18-persistence','eval-baseline','durable-prove','mutation-v12','mutation-v13','roast-dynamic','roast-static','roast-validate','build','release-audit'];
const softwareGatesPassed=requiredSoftware.every(n=>gates[n]?.status==='passed')&&tests.success===true&&Object.values(foundry.verticalSlices??{}).every(v=>v==='passed')&&persistence.status==='passed';
const evidencePaths=[
 'docs/canonical/evidence/v18/full-tests/summary.json','docs/canonical/evidence/v18/V18_CAPABILITY_FOUNDRY_EVIDENCE.json','docs/canonical/evidence/v18/V18_CAPABILITY_REGISTRY_EXPORT.json','docs/canonical/evidence/v18/V18_MISSION_COMPILER_EVIDENCE.json','docs/canonical/evidence/v18/V18_POLICY_EVIDENCE.json','docs/canonical/evidence/v18/V18_SANDBOX_EVIDENCE.json','docs/canonical/evidence/v18/V18_SELF_IMPROVEMENT_EVIDENCE.json','docs/canonical/evidence/v18/V18_MULTI_AGENT_EVIDENCE.json','docs/canonical/evidence/v18/V18_EVALUATION_EVIDENCE.json','docs/canonical/evidence/v18/V18_ADVERSARIAL_EVIDENCE.json','docs/canonical/evidence/v18/persistence-proof.json','docs/roast/ROAST_FINDINGS.json'
];
const evidence=[];for(const p of evidencePaths){try{evidence.push(await hashFile(p));}catch{evidence.push({path:p,missing:true});}}
const bySeverity={};const byStatus={};for(const f of roast.findings??[]){bySeverity[f.severity]=(bySeverity[f.severity]??0)+1;byStatus[f.status]=(byStatus[f.status]??0)+1;}
const validation={
 schemaVersion:'titai.v18.validation.v1',generatedAt:new Date().toISOString(),release:'TITAI v18 Sovereign Capability Foundry',sourceVersion:(await readJson('package.json',{})).version,
 summary:{softwareGatesPassed,fullTitaiSovereignty:'SOVEREIGN DEVELOPMENT MODE',fullTitaiRelease:'DEVELOPMENT ONLY',capabilityFoundrySubsystem:softwareGatesPassed?'CONTROLLED CAPABILITY PILOT':'QUALIFIED DEVELOPMENT SYSTEM',physicalBlockerCount:physicalBlockers.length},
 gates,fullTests:tests.totals??null,focusedTests:{files:14,tests:60,status:gates['v18-tests']?.status},verticalSlices:foundry.verticalSlices??{},persistence:{status:persistence.status??'missing',evidenceHash:persistence.evidenceHash??null},physicalBlockers,
 roast:{total:(roast.findings??[]).length,bySeverity,byStatus,projectKillers:(roast.topProjectKillers??[]).length},evidence,
 limitations:['Restricted Node subprocess isolation is qualified only for bounded low-risk capabilities.','Physical TITAI pilot gates remain blocked without external hardware evidence.','The self-improvement proof is a controlled candidate lifecycle, not unrestricted autonomous production modification.']
};
await writeFile(path.join(root,out),JSON.stringify(validation,null,2)+'\n');
console.log(JSON.stringify(validation.summary));
if(!softwareGatesPassed)process.exitCode=1;
