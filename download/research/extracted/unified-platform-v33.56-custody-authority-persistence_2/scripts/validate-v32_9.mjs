import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve('.'),out=resolve(process.env.V32_6_RUN_DIR || (process.env.V32_6_RUN_ID?join('evidence/runs',process.env.V32_6_RUN_ID):'evidence/generated'));
const identity=JSON.parse(execFileSync('python3',['scripts/test_ops_context_v32_6.py','--identity'],{cwd:root,encoding:'utf8'}));
const required=['V32_6_FULL_TEST_RESULTS.json','V32_COVERAGE_REPORT.json','V32_TEST_QUALITY_AUDIT.json','V32_ARCHITECTURE_INTEGRITY.json','V32_8_STRATEGIC_MUTATION_RESULTS.json','V32_9_CLAIM_EXECUTION_MUTATION_RESULTS.json','V32_9_EVIDENCE_ARTIFACT_BINDING.json','V32_9_ADVERSARIAL_CLAIM_ROAST.json','V32_9_DESCRIPTION_CONTRACTS.json','V32_9_EVIDENCE_DEPENDENCY_DAG.json','V32_9_CAPABILITY_UTILIZATION.json','V32_9_CLAIM_EXECUTION_CLOSURE.json','V32_9_CLAIM_EXECUTION_SUMMARY.json'];
for(const name of required)if(!existsSync(join(out,name)))throw new Error(`v32_9_report_missing:${name}`);
const reports=Object.fromEntries(required.map(name=>[name,JSON.parse(readFileSync(join(out,name),'utf8'))]));
const fields=['sourceDigest','compiledArtifactDigest','testManifestDigest','testFilesDigest','packageLockDigest','environmentDigest'];
const coherent=Object.values(reports).every(report=>fields.every(field=>report[field]===identity[field]));
const full=reports['V32_6_FULL_TEST_RESULTS.json'],coverage=reports['V32_COVERAGE_REPORT.json'],quality=reports['V32_TEST_QUALITY_AUDIT.json'],architecture=reports['V32_ARCHITECTURE_INTEGRITY.json'],strategicMutation=reports['V32_8_STRATEGIC_MUTATION_RESULTS.json'],claimMutation=reports['V32_9_CLAIM_EXECUTION_MUTATION_RESULTS.json'],binding=reports['V32_9_EVIDENCE_ARTIFACT_BINDING.json'],roast=reports['V32_9_ADVERSARIAL_CLAIM_ROAST.json'],descriptions=reports['V32_9_DESCRIPTION_CONTRACTS.json'],dag=reports['V32_9_EVIDENCE_DEPENDENCY_DAG.json'],utilization=reports['V32_9_CAPABILITY_UTILIZATION.json'],closure=reports['V32_9_CLAIM_EXECUTION_CLOSURE.json'],summary=reports['V32_9_CLAIM_EXECUTION_SUMMARY.json'];
const assertions={
 oneExecutionIdentity:coherent,
 fullRegressionPassed:full.status==='passed'&&full.failed===0&&full.tests>=850&&!full.lifecycleLeak,
 coveragePreserved:coverage.status==='passed'&&coverage.current.linePercent>=99&&coverage.current.branchPercent>=96&&coverage.current.functionPercent>=98.5,
 qualityClean:quality.status==='passed'&&quality.criticalOrHighIssues===0&&quality.mediumIssues===0,
 architectureClosed:architecture.status==='PASS'&&architecture.metrics.closedCapabilityPathCount>=75&&architecture.metrics.sourceCycleCount===0&&architecture.metrics.untestedSourceCount===0,
 strategicMutationsAuthentic:strategicMutation.status==='passed'&&strategicMutation.mutantsKilledAuthentically===14&&strategicMutation.survivors===0&&strategicMutation.invalidKills===0,
 claimMutationsAuthentic:claimMutation.status==='passed'&&claimMutation.mutantsSpecified===12&&claimMutation.mutantsKilledAuthentically===12&&claimMutation.survivors===0&&claimMutation.invalidKills===0,
 artifactsReallyBound:binding.status==='PASS'&&binding.metrics.artifacts===6&&binding.metrics.bound===6,
 descriptionContractsVerified:descriptions.status==='PASS'&&descriptions.metrics.claims===6&&descriptions.metrics.verified===6,
 evidenceDagClosed:dag.status==='PASS'&&dag.metrics.stages===13,
 capabilitiesActuallyUsed:utilization.status==='PASS'&&utilization.metrics.capabilities===10&&utilization.metrics.utilized===10&&utilization.metrics.orphanSymbols===0,
 unsupportedClaimsRefuted:roast.status==='PASS_WITH_EXPECTED_REFUTATIONS'&&roast.metrics.survived===1&&roast.metrics.refuted===3,
 claimClosurePassed:closure.status==='PASS'&&closure.disposition==='CLAIMS_BOUND_TO_EXECUTION'&&closure.productionPromotion==='BLOCKED'&&summary.status==='PASS',
 productionStillBlocked:summary.productionPromotion==='BLOCKED'&&summary.externalToolRuns===0
};
const status=Object.values(assertions).every(Boolean)?'passed':'failed';
const report={version:'32.9',generatedAt:new Date().toISOString(),status,classification:'claim-to-execution-closure-and-real-evidence-binding',...identity,assertions,results:{tests:{total:full.tests,passed:full.passed,failed:full.failed,wallDurationMs:full.wallDurationMs},coverage:coverage.current,quality:{files:quality.filesAudited,testsDeclared:quality.testsDeclared,assertCalls:quality.assertCalls},architecture:architecture.metrics,mutations:{strategic:strategicMutation.mutantsKilledAuthentically,claimExecution:claimMutation.mutantsKilledAuthentically},artifacts:binding.metrics,descriptions:descriptions.metrics,dag:dag.metrics,utilization:utilization.metrics,claims:{survived:roast.metrics.survived,refuted:roast.metrics.refuted}},readiness:'Validated Integrated Pilot — claim descriptions bound to executed local evidence',productionPromotion:'blocked',externalQualification:'not executed'};
writeFileSync(join(out,'V32_9_FINAL_VALIDATION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(status!=='passed')process.exit(1);
