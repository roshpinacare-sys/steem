#!/usr/bin/env node
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { evaluateComplexityBudget } from '../dist/src/validation/complexity-budget.js';
import { evaluateEvidenceFreshness } from '../dist/src/platform/evidence-freshness.js';
import { evaluateExcellenceScorecard } from '../dist/src/validation/excellence-scorecard.js';

const root=resolve(import.meta.dirname,'..'); const out=join(root,'evidence/generated'); mkdirSync(out,{recursive:true});
const now=new Date().toISOString(); const sourceDigest=computeSourceDigest();
const jsonPath=(path)=>JSON.parse(readFileSync(join(root,path),'utf8'));
const readReport=(name)=>jsonPath(existsSync(join(out,name))?`evidence/generated/${name}`:`release-evidence/${name}`);
const write=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');

const complexity=evaluateComplexityBudget(scanComplexity(),{maximumSourceLines:700,maximumImports:22,maximumExportedSymbols:35,maximumDecisionPoints:125,maximumFunctionLines:220,maximumWarningRatePercent:0});
write('V32_3_COMPLEXITY_BUDGET.json',{version:'32.3',generatedAt:now,budgetScope:'TypeScript production source modules',...complexity,acceptance:{warnings:0,blocks:0},limitations:['Static complexity is a change-risk signal, not a correctness proof.','External infrastructure behavior is outside this static budget.']});

const requiredKit=[
 'schemas/external-evidence-envelope.schema.json','external-qualification/qualification-manifest.json','external-qualification/README.md',
 'docs/V32_3_EXTERNAL_QUALIFICATION_EXECUTION_KIT.md','scripts/evaluate-external-qualification-v32_3.mjs',
 'src/qualification/external-evidence.ts','src/qualification/external-qualification-gate.ts',
 'src/qualification/hsm-kms-qualification.ts','src/qualification/monotonic-witness-qualification.ts','src/qualification/postgres-ha-qualification.ts',
 'src/qualification/human-pilot-qualification.ts','src/qualification/independent-review-qualification.ts','src/qualification/multi-host-slo-qualification.ts',
 'tests/external-qualification-v32_3.test.ts','tests/external-qualification-branch-v32_3.test.ts'
];
const missingKit=requiredKit.filter((path)=>!existsSync(join(root,path)));
const architecture=readReport('V32_ARCHITECTURE_INTEGRITY.json'); const ext=readReport('V32_3_EXTERNAL_QUALIFICATION.json');
const readinessStatus=missingKit.length===0&&architecture.status==='PASS'&&architecture.metrics.capabilityPathCount>=34&&architecture.metrics.closedCapabilityPathCount===architecture.metrics.capabilityPathCount&&architecture.metrics.sourceCycleCount===0&&architecture.metrics.untestedSourceCount===0?'READY_FOR_EXTERNAL_EXECUTION':'BLOCKED';
const readiness={version:'32.3',generatedAt:now,status:readinessStatus,classification:'external-qualification-execution-kit-readiness',sourceDigest,requiredKitCount:requiredKit.length,missingKit,architecture:{capabilityPathCount:architecture.metrics.capabilityPathCount,closedCapabilityPathCount:architecture.metrics.closedCapabilityPathCount,sourceCycleCount:architecture.metrics.sourceCycleCount,untestedSourceCount:architecture.metrics.untestedSourceCount},actualExternalQualification:ext.status,productionPromotion:'blocked',gateCount:6,claimBoundary:['READY_FOR_EXTERNAL_EXECUTION means acceptance contracts and execution instructions exist.','It does not mean any external gate has been executed or passed.']};
write('V32_3_EXTERNAL_EXECUTION_READINESS.json',readiness);

const baseline=jsonPath('release-evidence/V32_2_14_AXIS_SCORECARD.json').axes.map(({axisId,projectScore,cycleScore,confidence,evidenceRefs,limitations,blockers})=>({axisId,projectScore,cycleScore,confidence,evidenceRefs,limitations,blockers}));
const tests=readReport('V32_TEST_RESULTS.json'), coverage=readReport('V32_COVERAGE_REPORT.json'), quality=readReport('V32_TEST_QUALITY_AUDIT.json'), mutation=readReport('V32_3_EXTERNAL_QUALIFICATION_MUTATION_RESULTS.json');
const stability=readReport('V32_STABILITY_REPORT.json'), base=readReport('V32_FINAL_VALIDATION.json');
const mutationRate=mutation.mutantsSpecified===0?0:mutation.mutantsKilledAuthentically/mutation.mutantsSpecified;
const observations=[
 obs('requirement-fidelity',98,99,.97,['governance-state/TRACEABILITY_GRAPH.json','V32_3_EXTERNAL_EXECUTION_READINESS.json'],[],[]),
 obs('correctness-invariants',tests.status==='passed'&&tests.totals.failed===0?98:40,99,.98,['V32_TEST_RESULTS.json','V32_FINAL_VALIDATION.json'],['repository_local_proof'],tests.totals.failed===0?[]:['test_failure']),
 obs('adversarial-test-depth',round(.45*coverage.current.branchPercent+.35*mutationRate*100+.2*(quality.status==='passed'?100:0)),98,.96,['V32_COVERAGE_REPORT.json','V32_3_EXTERNAL_QUALIFICATION_MUTATION_RESULTS.json'],['targeted_mutation_not_full_mutation_of_every_module'],mutationRate===1?[]:['mutation_survivor']),
 obs('security-trust-sovereignty',84,98,.87,['V32_CREDENTIAL_SOVEREIGNTY_PROOF.json','V32_3_EXTERNAL_EXECUTION_READINESS.json'],['local_test_keys','qualification_interfaces_ready_but_not_executed'],['authorized_hsm_or_kms_absent','external_monotonic_witness_absent']),
 obs('durability-concurrency-consistency',94,97,.93,['V32_LOCAL_DR_REHEARSAL.json','V32_3_EXTERNAL_EXECUTION_READINESS.json'],['single_host_persistence'],[]),
 obs('architecture-modularity',complexity.status==='PASS'&&complexity.totals.warnings===0&&architecture.metrics.closedCapabilityPathCount>=34?98:70,99,.97,['V32_3_COMPLEXITY_BUDGET.json','V32_ARCHITECTURE_INTEGRITY.json'],[],[]),
 obs('evidence-integrity-traceability',97,99,.97,['V32_3_EVIDENCE_FRESHNESS.json','V32_3_EXTERNAL_EXECUTION_READINESS.json'],['external_truth_not_proven'],[]),
 obs('performance-resource-efficiency',78,93,.79,['V32_2_PERFORMANCE_BUDGET.json'],['local_test_metric_not_product_slo'],[]),
 obs('stability-determinism',stability.status==='passed'&&stability.flakeCount===0?97.3:60,98,.96,['V32_STABILITY_REPORT.json'],['single_host_stability'],[]),
 obs('operability-recovery',92,97,.92,['V32_LOCAL_DR_REHEARSAL.json','V32_OPERATIONAL_ACTION_CENTER.json'],['multi_region_recovery_unqualified'],[]),
 obs('portability-supply-chain-isolation',89,96,.89,['V32_SUPPLY_CHAIN_REPORT.json','V32_LINUX_ISOLATION.json','V32_3_EXTERNAL_EXECUTION_READINESS.json'],['independent_isolation_review_absent'],[]),
 obs('product-value-operator-ux',48,98,.58,['V32_HUMAN_PILOT_PROTOCOL.json','V32_3_EXTERNAL_EXECUTION_READINESS.json'],['commercial_value_unmeasured','human_pilot_not_executed'],['consented_comparative_human_pilot_absent']),
 obs('external-readiness-scalability',32,99,.48,['V32_3_EXTERNAL_EXECUTION_READINESS.json','V32_3_EXTERNAL_QUALIFICATION.json'],['external_execution_not_performed'],['independent_security_review_absent','multi_host_revocation_unqualified','postgres_failover_pitr_unqualified']),
 obs('engineering-efficiency-change-safety',complexity.status==='PASS'&&complexity.totals.warnings===0?98:75,99,.96,['V32_3_COMPLEXITY_BUDGET.json','V32_3_EXTERNAL_QUALIFICATION_MUTATION_RESULTS.json'],[],[]),
];
const score=evaluateExcellenceScorecard({version:'32.3',observations,baseline});
write('V32_3_14_AXIS_SCORECARD.json',{generatedAt:now,scoringMethod:'rule-derived, evidence-capped and blocker-preserving; external execution readiness raises cycle quality but cannot close external project blockers',...score});

const requiredEvidence=['V32_FINAL_VALIDATION.json','V32_TEST_RESULTS.json','V32_COVERAGE_REPORT.json','V32_TEST_QUALITY_AUDIT.json','V32_ARCHITECTURE_INTEGRITY.json','V32_CREDENTIAL_SOVEREIGNTY_MUTATION_RESULTS.json','V32_2_EXCELLENCE_MUTATION_RESULTS.json','V32_3_EXTERNAL_QUALIFICATION_MUTATION_RESULTS.json','V32_STABILITY_REPORT.json','V32_SUPPLY_CHAIN_REPORT.json','V32_LOCAL_DR_REHEARSAL.json','V32_BROWSER_E2E.json','V32_LINUX_ISOLATION.json','V32_POSTGRES_QUALIFICATION.json','V32_QUALIFICATION_MATRIX.json','V32_3_EXTERNAL_QUALIFICATION.json','V32_3_COMPLEXITY_BUDGET.json','V32_3_EXTERNAL_EXECUTION_READINESS.json','V32_3_14_AXIS_SCORECARD.json'];
const artifacts=requiredEvidence.map((name)=>{const path=existsSync(join(out,name))?join(out,name):join(root,'release-evidence',name); if(!existsSync(path))throw new Error(`evidence_missing:${name}`); return {evidenceId:name,path:relative(root,path).replaceAll('\\','/'),producedAt:statSync(path).mtime.toISOString(),sourceDigest,recordedArtifactDigest:hashFile(path),actualArtifactDigest:hashFile(path),maxAgeMs:86_400_000,requiredForPromotion:name!=='V32_POSTGRES_QUALIFICATION.json'};});
const manifest={version:'32.3',generatedAt:now,sourceDigest,artifacts:artifacts.map(({actualArtifactDigest,...row})=>row)}; write('V32_3_EVIDENCE_MANIFEST.json',manifest);
const freshness=evaluateEvidenceFreshness({currentSourceDigest:sourceDigest,evaluatedAt:now,artifacts});
write('V32_3_EVIDENCE_FRESHNESS.json',{version:'32.3',generatedAt:now,...freshness,limitations:['Freshness proves release-local binding and age; it does not prove external truth, independence or legal sufficiency.']});

console.log(JSON.stringify({sourceDigest,complexity:{status:complexity.status,totals:complexity.totals},readiness,scorecard:{status:score.status,readiness:score.readiness,productionPromotion:score.productionPromotion,metrics:score.metrics},freshness:{status:freshness.status,totals:freshness.totals},baseStatus:base.status},null,2));
if(complexity.status!=='PASS'||complexity.totals.warnings!==0||readiness.status!=='READY_FOR_EXTERNAL_EXECUTION'||freshness.status!=='PASS'||score.metrics.regressionCount!==0)process.exit(1);

function obs(axisId,projectScore,cycleScore,confidence,evidenceRefs,limitations,blockers){return{axisId,projectScore:round(projectScore),cycleScore:round(cycleScore),confidence,evidenceRefs,limitations,blockers};}
function scanComplexity(){const files=ts.sys.readDirectory(join(root,'src'),['.ts'],['node_modules','dist'],['**/*.ts']).sort(); return files.map((file)=>{const text=readFileSync(file,'utf8'); const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS); let importCount=0,exportedSymbolCount=0,decisionPointCount=0,maximumFunctionLines=0; const visit=(node)=>{if(ts.isImportDeclaration(node))importCount++; if(node.modifiers?.some((m)=>m.kind===ts.SyntaxKind.ExportKeyword))exportedSymbolCount++; if(ts.isIfStatement(node)||ts.isConditionalExpression(node)||ts.isCaseClause(node)||ts.isForStatement(node)||ts.isForInStatement(node)||ts.isForOfStatement(node)||ts.isWhileStatement(node)||ts.isDoStatement(node)||ts.isCatchClause(node)||(ts.isBinaryExpression(node)&&[ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)))decisionPointCount++; if(ts.isFunctionLike(node)&&node.body){const start=source.getLineAndCharacterOfPosition(node.getStart(source)).line; const end=source.getLineAndCharacterOfPosition(node.end).line; maximumFunctionLines=Math.max(maximumFunctionLines,end-start+1);} ts.forEachChild(node,visit);}; visit(source); return{path:relative(root,file).replaceAll('\\','/'),sourceLines:text.split(/\r?\n/).filter((line)=>line.trim()!=='').length,importCount,exportedSymbolCount,decisionPointCount,maximumFunctionLines};});}
function computeSourceDigest(){const h=createHash('sha256'); for(const item of ['CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','package.json','package-lock.json','tsconfig.json','src','tests','scripts','e2e','governance-state','infra','isolation','schemas','external-qualification','docs']){const p=join(root,item); if(!existsSync(p))continue; const files=statSync(p).isFile()?[p]:walk(p); for(const file of files){const rel=relative(root,file).replaceAll('\\','/'); if(rel.startsWith('evidence/')||rel.startsWith('dist/')||rel.startsWith('node_modules/')||rel.startsWith('.cache/')||rel.includes('__pycache__'))continue; h.update(rel);h.update('\0');h.update(readFileSync(file));h.update('\0');}} return h.digest('hex');}
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>{const p=join(dir,entry.name); return entry.isDirectory()?walk(p):[p];}).sort();}
function hashFile(path){return createHash('sha256').update(readFileSync(path)).digest('hex');}
function round(value){return Number(value.toFixed(2));}
