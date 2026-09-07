#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'); const out=join(root,'evidence/generated'); mkdirSync(out,{recursive:true}); const json=(name)=>JSON.parse(readFileSync(join(out,name),'utf8'));
const required=['V32_FINAL_VALIDATION.json','V32_3_EXTERNAL_QUALIFICATION_MUTATION_RESULTS.json','V32_3_EXTERNAL_QUALIFICATION.json','V32_3_EXTERNAL_EXECUTION_READINESS.json','V32_3_COMPLEXITY_BUDGET.json','V32_3_14_AXIS_SCORECARD.json','V32_3_EVIDENCE_FRESHNESS.json'];
for(const name of required)if(!existsSync(join(out,name)))throw new Error(`v32_3_report_missing:${name}`);
const base=json('V32_FINAL_VALIDATION.json'), mutation=json('V32_3_EXTERNAL_QUALIFICATION_MUTATION_RESULTS.json'), external=json('V32_3_EXTERNAL_QUALIFICATION.json'), readiness=json('V32_3_EXTERNAL_EXECUTION_READINESS.json'), complexity=json('V32_3_COMPLEXITY_BUDGET.json'), score=json('V32_3_14_AXIS_SCORECARD.json'), freshness=json('V32_3_EVIDENCE_FRESHNESS.json');
const internalAxes=score.axes.filter((axis)=>!['security-trust-sovereignty','product-value-operator-ux','external-readiness-scalability'].includes(axis.axisId));
const assertions={
 baseValidationPassed:base.status==='passed',
 testsExpanded:base.results.tests.tests>=673&&base.results.tests.failed===0&&base.results.tests.tests===base.results.tests.passed,
 retainedCoverageFloors:base.results.coverage.linePercent>=99&&base.results.coverage.branchPercent>=96&&base.results.coverage.functionPercent>=98.5,
 architectureExternallyReady:base.results.architecture.capabilityPathCount>=34&&base.results.architecture.closedCapabilityPathCount===base.results.architecture.capabilityPathCount&&base.results.architecture.sourceCycleCount===0&&base.results.architecture.untestedSourceCount===0,
 complexityDebtClosed:complexity.status==='PASS'&&complexity.totals.warnings===0&&complexity.totals.blocks===0,
 externalMutationsAuthentic:mutation.status==='passed'&&mutation.mutantsSpecified>=13&&mutation.mutantsKilledAuthentically===mutation.mutantsSpecified&&mutation.survivors===0&&mutation.invalidKills===0,
 kitReady:readiness.status==='READY_FOR_EXTERNAL_EXECUTION'&&readiness.missingKit.length===0&&readiness.gateCount===6,
 externalExecutionHonest:['NOT_EXECUTED','BLOCKED','QUALIFIED'].includes(external.status)&&external.productionPromotion==='blocked',
 noFabricatedQualification:external.status==='NOT_EXECUTED'&&external.missingFiles.length===6,
 fourteenAxesTracked:score.metrics.axisCount===14&&score.metrics.totalWeight===100&&score.metrics.regressionCount===0,
 internalAxesMeetFloors:internalAxes.every((axis)=>axis.projectScore>=axis.projectFloor&&axis.cycleScore>=axis.cycleFloor),
 productionHonestlyBlocked:score.productionPromotion==='BLOCKED'&&score.readiness==='INTEGRATED_PILOT',
 evidenceFresh:freshness.status==='PASS'&&freshness.totals.current===freshness.totals.artifacts,
};
const status=Object.values(assertions).every(Boolean)?'passed-external-ready-integrated-pilot-production-blocked':'failed';
const artifacts=required.map((name)=>({path:`evidence/generated/${name}`,sha256:createHash('sha256').update(readFileSync(join(out,name))).digest('hex')}));
const report={version:'32.3',status,classification:'external-qualification-readiness-and-zero-warning-internal-debt-closure',sourceDigest:base.sourceDigest,assertions,results:{tests:base.results.tests,coverage:base.results.coverage,architecture:base.results.architecture,retainedCredentialMutations:base.results.mutations,externalQualificationMutations:{specified:mutation.mutantsSpecified,killed:mutation.mutantsKilledAuthentically},complexity:complexity.totals,externalExecutionReadiness:{status:readiness.status,gateCount:readiness.gateCount},externalQualification:{status:external.status,passedGates:external.passedGates,totalGates:external.totalGates},scorecard:score.metrics,evidenceFreshness:freshness.totals},readiness:'Integrated Pilot — ready for external execution',productionPromotion:'blocked',externalGates:['Authorized HSM/KMS custody','Independent monotonic witness','PostgreSQL HA/RLS/failover/PITR','Consented comparative human pilot','Independent security/isolation/supply-chain/licensing review','Multi-host SLO/revocation/recovery'],artifacts};
writeFileSync(join(out,'V32_3_FINAL_VALIDATION.json'),JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2)); if(status==='failed')process.exit(1);
