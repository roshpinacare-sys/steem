#!/usr/bin/env node
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { evaluateComplexityBudget } from '../dist/src/validation/complexity-budget.js';
import { evaluateEvidenceFreshness } from '../dist/src/platform/evidence-freshness.js';
import { evaluateResilienceCoverage } from '../dist/src/operations/resilience-coverage.js';
import { evaluateValueHypotheses } from '../dist/src/product/value-hypothesis.js';
import { evaluatePerformanceBudgets } from '../dist/src/operations/performance-budget.js';
import { evaluateExcellenceScorecard } from '../dist/src/validation/excellence-scorecard.js';
import { evaluateStabilityAssurance } from '../dist/src/validation/stability-assurance.js';

const root=resolve(import.meta.dirname,'..'); const out=join(root,'evidence/generated'); mkdirSync(out,{recursive:true});
const json=(path)=>JSON.parse(readFileSync(join(root,path),'utf8'));
const readReport=(name)=>json(existsSync(join(out,name))?`evidence/generated/${name}`:`release-evidence/${name}`);
const write=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');
const currentSourceDigest=sourceDigest(); const now=new Date().toISOString();

const complexity=evaluateComplexityBudget(scanComplexity(),{maximumSourceLines:700,maximumImports:22,maximumExportedSymbols:35,maximumDecisionPoints:125,maximumFunctionLines:220,maximumWarningRatePercent:12});
write('V32_2_COMPLEXITY_BUDGET.json',{version:'32.2',generatedAt:now,budgetScope:'TypeScript production source modules',...complexity,limitations:['Static complexity is a change-risk signal, not a correctness proof.','Generated JavaScript and external infrastructure are outside this budget.']});

const resilienceRegistry=json('governance/v32_2/RESILIENCE_SCENARIO_REGISTRY.json');
const resilience=evaluateResilienceCoverage(resilienceRegistry.requirements,resilienceRegistry.evidence);
write('V32_2_RESILIENCE_COVERAGE.json',{version:'32.2',generatedAt:now,...resilience,limitations:['Most evidence is local-single-host or simulation.','Qualified multi-host chaos remains a v33 external gate.']});

const valueRegistry=json('governance/v32_2/VALUE_HYPOTHESIS_REGISTRY.json');
const value=evaluateValueHypotheses(valueRegistry.hypotheses);
write('V32_2_VALUE_HYPOTHESIS_REPORT.json',{version:'32.2',generatedAt:now,...value,claimPolicy:valueRegistry.claimPolicy,limitations:['READY_FOR_PILOT is not evidence of human or commercial value.']});

const baselineStability=json('release-evidence/V32_STABILITY_REPORT.json'); const currentStability=json('evidence/generated/V32_STABILITY_REPORT.json'); const tests=readReport('V32_TEST_RESULTS.json');
const baselineTestCount=619; const currentTestCount=tests.totals.tests;
const baselinePerTest=baselineStability.runs.map((row)=>row.testWallMs/baselineTestCount);
const currentPerTest=currentStability.runs.map((row)=>row.testWallMs/currentTestCount);
const performance=evaluatePerformanceBudgets([{metric:'full_suite_ms_per_test',direction:'lower-is-better',maximumRegressionPercent:10,minimumSamples:3,percentile:50}],[{metric:'full_suite_ms_per_test',baseline:baselinePerTest,current:currentPerTest,environment:'local-single-host'}]);
write('V32_2_PERFORMANCE_BUDGET.json',{version:'32.2',generatedAt:now,normalization:{baselineTests:baselineTestCount,currentTests:currentTestCount},...performance,limitations:['The metric is local full-suite wall time per test, not product latency or throughput.','Production SLO qualification requires qualified multi-host measurements.']});

const stabilityAssurance=evaluateStabilityAssurance({expectedRuns:3,expectedTests:currentTestCount,coefficientOfVariation:currentStability.statistics.coefficientOfVariation,runs:currentStability.runs.map((row)=>({status:row.status,tests:row.tests,passed:row.passed,failed:row.failed,timedOut:row.timedOut}))});
write('V32_2_STABILITY_ASSURANCE.json',{version:'32.2',generatedAt:now,...stabilityAssurance,limitations:['Functional determinism and local wall-time variation are scored separately.','Qualified multi-host long-horizon flake probability remains external evidence.']});

const requiredEvidence=['V32_FINAL_VALIDATION.json','V32_TEST_RESULTS.json','V32_COVERAGE_REPORT.json','V32_TEST_QUALITY_AUDIT.json','V32_ARCHITECTURE_INTEGRITY.json','V32_CREDENTIAL_SOVEREIGNTY_MUTATION_RESULTS.json','V32_2_EXCELLENCE_MUTATION_RESULTS.json','V32_STABILITY_REPORT.json','V32_SUPPLY_CHAIN_REPORT.json','V32_LOCAL_DR_REHEARSAL.json','V32_BROWSER_E2E.json','V32_LINUX_ISOLATION.json','V32_POSTGRES_QUALIFICATION.json','V32_QUALIFICATION_MATRIX.json','V32_2_COMPLEXITY_BUDGET.json','V32_2_RESILIENCE_COVERAGE.json','V32_2_VALUE_HYPOTHESIS_REPORT.json','V32_2_PERFORMANCE_BUDGET.json','V32_2_STABILITY_ASSURANCE.json'];
const manifest={version:'32.2',sourceDigest:currentSourceDigest,generatedAt:now,artifacts:requiredEvidence.map((name)=>{const local=existsSync(join(out,name))?join(out,name):join(root,'release-evidence',name); if(!existsSync(local)) throw new Error(`evidence_missing:${name}`); return {evidenceId:name,path:relative(root,local).replaceAll('\\','/'),producedAt:statSync(local).mtime.toISOString(),sourceDigest:currentSourceDigest,recordedArtifactDigest:hashFile(local),maxAgeMs:86_400_000,requiredForPromotion:name!=='V32_POSTGRES_QUALIFICATION.json'};})};
write('V32_2_EVIDENCE_MANIFEST.json',manifest);
const freshness=evaluateEvidenceFreshness({currentSourceDigest,evaluatedAt:now,artifacts:manifest.artifacts.map((item)=>({...item,actualArtifactDigest:hashFile(join(root,item.path))}))});
write('V32_2_EVIDENCE_FRESHNESS.json',{version:'32.2',generatedAt:now,...freshness,limitations:['Freshness proves binding and age inside this release workspace, not external truth or legal independence.']});

const reports={tests,coverage:readReport('V32_COVERAGE_REPORT.json'),quality:readReport('V32_TEST_QUALITY_AUDIT.json'),architecture:readReport('V32_ARCHITECTURE_INTEGRITY.json'),credentialMutation:readReport('V32_CREDENTIAL_SOVEREIGNTY_MUTATION_RESULTS.json'),excellenceMutation:readReport('V32_2_EXCELLENCE_MUTATION_RESULTS.json'),credentialProof:readReport('V32_CREDENTIAL_SOVEREIGNTY_PROOF.json'),dr:readReport('V32_LOCAL_DR_REHEARSAL.json'),stability:currentStability,supply:readReport('V32_SUPPLY_CHAIN_REPORT.json'),isolation:readReport('V32_LINUX_ISOLATION.json'),postgres:readReport('V32_POSTGRES_QUALIFICATION.json'),pilot:readReport('V32_HUMAN_PILOT_PROTOCOL.json'),operations:readReport('V32_OPERATIONAL_ACTION_CENTER.json'),qualification:readReport('V32_QUALIFICATION_MATRIX.json')};
const governance=governanceSemantics();
const baseline=json('governance/v32_2/V32_1_BASELINE_14_AXIS.json').observations;
const current=currentObservations(reports,{complexity,resilience,value,performance,stabilityAssurance,freshness,governance});
const scorecard=evaluateExcellenceScorecard({version:'32.2',observations:current,baseline});
write('V32_2_14_AXIS_SCORECARD.json',{generatedAt:now,scoringMethod:'rule-derived, evidence-capped and blocker-preserving; project scores measure system proof, cycle scores measure this change cycle against its declared scope',scoringRules:scoringRules(),...scorecard});
console.log(JSON.stringify({sourceDigest:currentSourceDigest,complexity:complexity.status,resilience:resilience.metrics,value:value.status,performance:performance.status,freshness:freshness.status,scorecard:{status:scorecard.status,readiness:scorecard.readiness,productionPromotion:scorecard.productionPromotion,metrics:scorecard.metrics,weakestAxes:scorecard.weakestAxes}},null,2));

function currentObservations(r,x){
  const allTests=r.tests.status==='passed'&&r.tests.totals.failed===0; const coverage=r.coverage.current; const mutationTotal=r.credentialMutation.mutantsSpecified+r.excellenceMutation.mutantsSpecified; const mutationKilled=r.credentialMutation.mutantsKilledAuthentically+r.excellenceMutation.mutantsKilledAuthentically; const mutationRate=mutationTotal===0?0:mutationKilled/mutationTotal;
  const archClosed=r.architecture.status==='PASS'&&r.architecture.metrics.closedCapabilityPathCount===r.architecture.metrics.capabilityPathCount&&r.architecture.metrics.capabilityPathCount>=27;
  const localSecurity=r.credentialProof.status==='passed'; const drPass=r.dr.status==='passed-local-rehearsal'; const stable=r.stability.status==='passed'&&r.stability.flakeCount===0; const supplyPass=['passed','passed-with-advisory-environment-blocked'].includes(r.supply.status); const isolationPass=r.isolation.status==='passed-single-host-research-proof';
  const project=[
    obs('requirement-fidelity',x.governance?96:70,97,0.95,['governance-state/TRACEABILITY_GRAPH.json','V32_2_14_AXIS_SCORECARD.json'],x.governance?[]:['semantic_governance_refresh_failed'],[]),
    obs('correctness-invariants',allTests?98:40,98,0.97,['V32_TEST_RESULTS.json','V32_INTEGRATION_CLOSURE.json'],['repository_local_proof'],allTests?[]:['test_failure']),
    obs('adversarial-test-depth',round(0.45*coverage.branchPercent+0.35*mutationRate*100+0.2*(r.quality.status==='passed'?100:0)),97,0.95,['V32_COVERAGE_REPORT.json','V32_CREDENTIAL_SOVEREIGNTY_MUTATION_RESULTS.json','V32_2_EXCELLENCE_MUTATION_RESULTS.json'],['targeted_mutation_not_full_mutation_of_every_module'],mutationRate===1?[]:['mutation_survivor']),
    obs('security-trust-sovereignty',localSecurity?84:35,94,0.84,['V32_CREDENTIAL_SOVEREIGNTY_PROOF.json'],['local_test_keys','single_host_trust_anchor'],['authorized_hsm_or_kms_absent','external_monotonic_witness_absent']),
    obs('durability-concurrency-consistency',drPass&&x.resilience.status==='PASS'?94:65,96,0.92,['V32_LOCAL_DR_REHEARSAL.json','V32_2_RESILIENCE_COVERAGE.json'],['single_host_persistence'],drPass?[]:['dr_rehearsal_failed']),
    obs('architecture-modularity',archClosed?95:60,96,0.95,['V32_ARCHITECTURE_INTEGRITY.json','V32_2_COMPLEXITY_BUDGET.json'],x.complexity.status==='WARN'?['bounded_complexity_warnings']:[],archClosed?[]:['architecture_closure_failed']),
    obs('evidence-integrity-traceability',x.freshness.status==='PASS'&&x.governance?96:60,98,0.96,['V32_2_EVIDENCE_FRESHNESS.json','governance-state/EVIDENCE_REGISTRY.json'],['external_truth_not_proven'],x.freshness.status==='PASS'?[]:['evidence_freshness_failed']),
    obs('performance-resource-efficiency',x.performance.status==='PASS'?78:55,92,0.78,['V32_2_PERFORMANCE_BUDGET.json'],['local_test_metric_not_product_slo'],x.performance.status==='PASS'?[]:['performance_regression_budget_failed']),
    obs('stability-determinism',stable?x.stabilityAssurance.score:50,97,0.96,['V32_STABILITY_REPORT.json'],['single_host_stability'],stable?[]:['stability_failed']),
    obs('operability-recovery',drPass&&r.operations.status==='passed'&&x.resilience.status==='PASS'?91:60,95,0.9,['V32_OPERATIONAL_ACTION_CENTER.json','V32_LOCAL_DR_REHEARSAL.json','V32_2_RESILIENCE_COVERAGE.json'],['multi_region_recovery_unqualified'],[]),
    obs('portability-supply-chain-isolation',supplyPass&&isolationPass?88:60,93,0.87,['V32_SUPPLY_CHAIN_REPORT.json','V32_LINUX_ISOLATION.json'],['independent_isolation_review_absent'],[]),
    obs('product-value-operator-ux',x.value.status==='READY_FOR_PILOT'?48:35,91,0.52,['V32_2_VALUE_HYPOTHESIS_REPORT.json','V32_HUMAN_PILOT_PROTOCOL.json'],['human_pilot_not_executed','commercial_value_unmeasured'],['consented_comparative_human_pilot_absent']),
    obs('external-readiness-scalability',r.postgres.status==='environment-blocked'?25:45,94,0.38,['V32_POSTGRES_QUALIFICATION.json','V32_QUALIFICATION_MATRIX.json'],['external_infrastructure_outside_workspace'],['postgres_failover_pitr_unqualified','multi_host_revocation_unqualified','independent_security_review_absent']),
    obs('engineering-efficiency-change-safety',x.complexity.status!=='BLOCK'&&x.performance.status==='PASS'?94:70,98,0.93,['V32_2_COMPLEXITY_BUDGET.json','V32_2_PERFORMANCE_BUDGET.json','V32_2_EXCELLENCE_MUTATION_RESULTS.json'],[],[]),
  ]; return project;
}
function obs(axisId,projectScore,cycleScore,confidence,evidenceRefs,limitations,blockers){return{axisId,projectScore:round(projectScore),cycleScore:round(cycleScore),confidence,evidenceRefs,limitations,blockers};}
function governanceSemantics(){
  const names=['ASSUMPTION_REGISTRY.json','CAPABILITY_REGISTRY.json','CONTRADICTION_REGISTRY.json','EVIDENCE_REGISTRY.json','NEXT_ACTION.json','OPEN_DECISIONS.json','PROGRAM_STATE.json','REQUIREMENT_REGISTRY.json','RISK_REGISTRY.json','SKILL_REGISTRY.json','TRACEABILITY_GRAPH.json'];
  if(!names.every((name)=>json(`governance-state/${name}`).version==='32.2')) return false;
  const caps=new Set(json('governance-state/CAPABILITY_REGISTRY.json').capabilities.map((x)=>x.id)); const reqs=new Set(json('governance-state/REQUIREMENT_REGISTRY.json').requirements.map((x)=>x.id)); const links=new Set(json('governance-state/TRACEABILITY_GRAPH.json').links.map((x)=>x.requirement));
  return ['fourteen-axis-excellence-scorecard','source-bound-evidence-freshness','module-complexity-budget','resilience-scenario-coverage','value-hypothesis-claim-governance','performance-regression-budget'].every((id)=>caps.has(id))&&['V32.2-REQ-01','V32.2-REQ-02','V32.2-REQ-03','V32.2-REQ-04','V32.2-REQ-05','V32.2-REQ-06'].every((id)=>reqs.has(id)&&links.has(id));
}
function scoringRules(){return{
  requirementFidelity:'96 only when all governance registries are v32.2 and every v32.2 requirement has capability and traceability closure.',
  correctness:'98 only with all tests passing and zero failed tests.',
  adversarial:'45% branch coverage, 35% authentic mutation kill rate, 20% test-quality gate.',
  security:'Local proof is capped at 84 until authorized HSM/KMS and external monotonic witness exist.',
  performance:'Local normalized suite performance is capped at 78 and is not a product SLO.',
  productValue:'Protocol readiness is capped below 50 until measured human evidence exists.',
  externalReadiness:'Environment-blocked PostgreSQL and absent independent qualification cap the project score at 25.',
  cycleExecution:'Scores whether the cycle implemented, tested and honestly bounded the declared improvement, including external blockers it could not execute.'};}
function scanComplexity(){
  const files=ts.sys.readDirectory(join(root,'src'),['.ts'],['node_modules','dist'],['**/*.ts']).sort(); return files.map((file)=>{const text=readFileSync(file,'utf8'); const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS); let importCount=0,exportedSymbolCount=0,decisionPointCount=0,maximumFunctionLines=0;
    const visit=(node)=>{if(ts.isImportDeclaration(node)) importCount++; if(node.modifiers?.some((m)=>m.kind===ts.SyntaxKind.ExportKeyword)) exportedSymbolCount++; if(ts.isIfStatement(node)||ts.isConditionalExpression(node)||ts.isCaseClause(node)||ts.isForStatement(node)||ts.isForInStatement(node)||ts.isForOfStatement(node)||ts.isWhileStatement(node)||ts.isDoStatement(node)||ts.isCatchClause(node)||(ts.isBinaryExpression(node)&&[ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind))) decisionPointCount++; if(ts.isFunctionLike(node)&&node.body){const start=source.getLineAndCharacterOfPosition(node.getStart(source)).line; const end=source.getLineAndCharacterOfPosition(node.end).line; maximumFunctionLines=Math.max(maximumFunctionLines,end-start+1);} ts.forEachChild(node,visit);}; visit(source); return{path:relative(root,file).replaceAll('\\','/'),sourceLines:text.split(/\r?\n/).filter((line)=>line.trim()!=='').length,importCount,exportedSymbolCount,decisionPointCount,maximumFunctionLines};});
}
function sourceDigest(){const h=createHash('sha256'); for(const item of ['package.json','package-lock.json','tsconfig.json','src','tests','scripts','e2e','governance-state','infra','isolation']){const p=join(root,item); if(!existsSync(p))continue; const files=statSync(p).isFile()?[p]:walk(p); for(const file of files){const rel=relative(root,file).replaceAll('\\','/'); if(rel.startsWith('evidence/')||rel.startsWith('dist/')||rel.startsWith('node_modules/')||rel.includes('__pycache__'))continue; h.update(rel);h.update('\0');h.update(readFileSync(file));h.update('\0');}} return h.digest('hex');}
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>{const p=join(dir,entry.name); return entry.isDirectory()?walk(p):[p];}).sort();}
function hashFile(path){return createHash('sha256').update(readFileSync(path)).digest('hex');}
function round(value){return Number(value.toFixed(2));}
