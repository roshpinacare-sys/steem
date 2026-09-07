#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'); const out=join(root,'evidence/generated'); mkdirSync(out,{recursive:true}); const json=(name)=>JSON.parse(readFileSync(join(out,name),'utf8'));
const required=['V32_FINAL_VALIDATION.json','V32_4_ALL_AXIS_MUTATION_RESULTS.json','V32_4_OPTIMIZATION_SUMMARY.json','V32_4_ALL_AXIS_SCORECARD.json','V32_4_EVIDENCE_FRESHNESS.json','V32_4_COMPLEXITY_BUDGET.json','V32_4_PRODUCT_PATH_BENCHMARK.json','V32_4_QUALIFICATION_EXECUTION_PLAN.json','V32_3_EXTERNAL_QUALIFICATION.json'];
for(const name of required)if(!existsSync(join(out,name)))throw new Error(`v32_4_report_missing:${name}`);
const base=json('V32_FINAL_VALIDATION.json'), mutation=json('V32_4_ALL_AXIS_MUTATION_RESULTS.json'), summary=json('V32_4_OPTIMIZATION_SUMMARY.json'), score=json('V32_4_ALL_AXIS_SCORECARD.json'), freshness=json('V32_4_EVIDENCE_FRESHNESS.json'), complexity=json('V32_4_COMPLEXITY_BUDGET.json'), benchmark=json('V32_4_PRODUCT_PATH_BENCHMARK.json'), plan=json('V32_4_QUALIFICATION_EXECUTION_PLAN.json'), external=json('V32_3_EXTERNAL_QUALIFICATION.json');
const baseline=JSON.parse(readFileSync(join(root,'release-evidence/V32_3_14_AXIS_SCORECARD.json'),'utf8'));
const improved=score.axes.every((axis)=>{const prior=baseline.axes.find((item)=>item.axisId===axis.axisId);return prior!==undefined&&axis.projectScore>prior.projectScore&&axis.cycleScore>=prior.cycleScore;});
const assertions={
 baseValidationPassed:base.status==='passed',
 testsExpanded:base.results.tests.tests>=701&&base.results.tests.failed===0,
 retainedCoverageFloors:base.results.coverage.linePercent>=99&&base.results.coverage.branchPercent>=96&&base.results.coverage.functionPercent>=98.5,
 architectureExpanded:base.results.architecture.capabilityPathCount>=48&&base.results.architecture.closedCapabilityPathCount===base.results.architecture.capabilityPathCount&&base.results.architecture.sourceCycleCount===0&&base.results.architecture.untestedSourceCount===0,
 allAxisMechanismsPassed:summary.status==='passed'&&summary.axisMechanisms===14,
 allAxesImproved:improved&&summary.rawImprovementCount===14&&score.metrics.improvementCount>=8&&score.metrics.regressionCount===0,
 mutationsAuthentic:mutation.status==='passed'&&mutation.mutantsSpecified===14&&mutation.mutantsKilledAuthentically===14&&mutation.survivors===0&&mutation.invalidKills===0,
 evidenceFresh:freshness.status==='PASS'&&freshness.totals.current===freshness.totals.artifacts,
 complexityClean:complexity.status==='PASS'&&complexity.totals.warnings===0&&complexity.totals.blocks===0,
 productPathsMeasured:benchmark.status==='PASS'&&benchmark.metrics.paths>=3&&benchmark.metrics.passed===benchmark.metrics.paths,
 externalPlanReady:plan.status==='READY'&&plan.metrics.gates===6&&plan.metrics.independentlyReviewed===6,
 externalTruthHonest:external.status==='NOT_EXECUTED'&&score.productionPromotion==='BLOCKED'&&score.axes.find((axis)=>axis.axisId==='product-value-operator-ux').blockers.length>0&&score.axes.find((axis)=>axis.axisId==='external-readiness-scalability').blockers.length>0,
};
const status=Object.values(assertions).every(Boolean)?'passed':'failed';
const report={version:'32.4',status,classification:'fourteen-axis-system-optimization-with-external-truth-boundaries-preserved',sourceDigest:base.sourceDigest,assertions,results:{tests:base.results.tests,coverage:base.results.coverage,architecture:base.results.architecture,scorecard:score.metrics,mutations:{specified:mutation.mutantsSpecified,killed:mutation.mutantsKilledAuthentically},complexity:complexity.totals,productBenchmark:benchmark.metrics,qualificationPlan:plan.metrics,evidenceFreshness:freshness.totals},readiness:'Integrated Pilot — maximized internal readiness and external execution acceleration',productionPromotion:'blocked',externalQualification:'not executed'};
writeFileSync(join(out,'V32_4_FINAL_VALIDATION.json'),JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2)); if(status==='failed')process.exit(1);
