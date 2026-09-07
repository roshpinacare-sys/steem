#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'); const out=join(root,'evidence/generated'); mkdirSync(out,{recursive:true}); const json=(name)=>JSON.parse(readFileSync(join(out,name),'utf8'));
const required=['V32_FINAL_VALIDATION.json','V32_2_EXCELLENCE_MUTATION_RESULTS.json','V32_2_14_AXIS_SCORECARD.json','V32_2_EVIDENCE_FRESHNESS.json','V32_2_COMPLEXITY_BUDGET.json','V32_2_RESILIENCE_COVERAGE.json','V32_2_VALUE_HYPOTHESIS_REPORT.json','V32_2_PERFORMANCE_BUDGET.json','V32_2_STABILITY_ASSURANCE.json'];
for(const name of required) if(!existsSync(join(out,name))) throw new Error(`v32_2_report_missing:${name}`);
const base=json('V32_FINAL_VALIDATION.json'), mutation=json('V32_2_EXCELLENCE_MUTATION_RESULTS.json'), score=json('V32_2_14_AXIS_SCORECARD.json'), freshness=json('V32_2_EVIDENCE_FRESHNESS.json'), complexity=json('V32_2_COMPLEXITY_BUDGET.json'), resilience=json('V32_2_RESILIENCE_COVERAGE.json'), value=json('V32_2_VALUE_HYPOTHESIS_REPORT.json'), performance=json('V32_2_PERFORMANCE_BUDGET.json'), stabilityAssurance=json('V32_2_STABILITY_ASSURANCE.json');
const internalAxes=score.axes.filter((axis)=>!['security-trust-sovereignty','product-value-operator-ux','external-readiness-scalability'].includes(axis.axisId));
const assertions={
  baseValidationPassed:base.status==='passed',
  testsExpanded:base.results.tests.tests>=654&&base.results.tests.failed===0,
  architectureExpanded:base.results.architecture.capabilityPathCount>=27&&base.results.architecture.closedCapabilityPathCount===base.results.architecture.capabilityPathCount,
  retainedCoverageFloors:base.results.coverage.linePercent>=99&&base.results.coverage.branchPercent>=96&&base.results.coverage.functionPercent>=98.5,
  excellenceMutationsAuthentic:mutation.status==='passed'&&mutation.mutantsSpecified>=13&&mutation.mutantsKilledAuthentically===mutation.mutantsSpecified&&mutation.survivors===0&&mutation.invalidKills===0,
  fourteenAxesTracked:score.metrics.axisCount===14&&score.metrics.totalWeight===100&&score.metrics.regressionCount===0,
  internalAxesMeetFloors:internalAxes.every((axis)=>axis.projectScore>=axis.projectFloor&&axis.cycleScore>=axis.cycleFloor),
  productionHonestlyBlocked:score.productionPromotion==='BLOCKED'&&score.readiness==='INTEGRATED_PILOT',
  evidenceFresh:freshness.status==='PASS'&&freshness.totals.current===freshness.totals.artifacts,
  complexityBounded:complexity.status!=='BLOCK',
  resilienceLocallyClosed:resilience.status==='PASS'&&resilience.metrics.coveragePercent===100,
  valueClaimsHonest:value.status==='READY_FOR_PILOT'&&value.metrics.humanMeasured===0&&value.forbiddenClaims.length===value.metrics.hypotheses,
  performanceBudgetPassed:performance.status==='PASS',
  stabilityAssurancePassed:stabilityAssurance.status==='PASS'&&stabilityAssurance.functionalDeterminism===true,
};
const status=Object.values(assertions).every(Boolean)?'passed-integrated-pilot-production-blocked':'failed';
const artifacts=required.map((name)=>({path:`evidence/generated/${name}`,sha256:createHash('sha256').update(readFileSync(join(out,name))).digest('hex')}));
const report={version:'32.2',status,classification:'fourteen-axis-excellence-evidence-freshness-resilience-value-and-performance-closure',sourceDigest:base.sourceDigest,assertions,results:{tests:base.results.tests,coverage:base.results.coverage,architecture:base.results.architecture,retainedCredentialMutations:base.results.mutations,excellenceMutations:{specified:mutation.mutantsSpecified,killed:mutation.mutantsKilledAuthentically},scorecard:score.metrics,weakestAxes:score.weakestAxes,complexity:complexity.totals,resilience:resilience.metrics,value:value.metrics,performance:performance.results,stabilityAssurance,evidenceFreshness:freshness.totals},readiness:'Integrated Pilot',productionPromotion:'blocked',externalGates:['PostgreSQL primary/standby failover and PITR','authorized HSM/KMS custody','external monotonic witness','multi-host revocation propagation','independent security and license review','consented comparative human pilot'],artifacts};
writeFileSync(join(out,'V32_2_FINAL_VALIDATION.json'),JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2)); if(status==='failed')process.exit(1);
