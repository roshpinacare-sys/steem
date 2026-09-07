import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve('.'),out=resolve(process.env.V32_6_RUN_DIR || (process.env.V32_6_RUN_ID ? join('evidence/runs', process.env.V32_6_RUN_ID) : 'evidence/generated'));
const identity=JSON.parse(execFileSync('python3',['scripts/test_ops_context_v32_6.py','--identity'],{cwd:root,encoding:'utf8'}));
const required=['V32_6_FULL_TEST_RESULTS.json','V32_COVERAGE_REPORT.json','V32_TEST_QUALITY_AUDIT.json','V32_ARCHITECTURE_INTEGRITY.json','V32_8_STRATEGIC_MUTATION_RESULTS.json','V32_8_WORKFLOW_SECURITY.json','V32_8_PINNED_ACTION_INTAKE.json','V32_8_ADVERSARIAL_CLAIM_ROAST.json','V32_8_GITHUB_TOOL_CATALOG.json','V32_8_STRATEGIC_ASSURANCE.json','V32_8_STRATEGIC_ADVERSARIAL_SUMMARY.json'];
for(const name of required)if(!existsSync(join(out,name)))throw new Error(`v32_8_report_missing:${name}`);
const reports=Object.fromEntries(required.map(name=>[name,JSON.parse(readFileSync(join(out,name),'utf8'))]));
const fields=['sourceDigest','compiledArtifactDigest','testManifestDigest','testFilesDigest','packageLockDigest','environmentDigest'];
const coherent=Object.values(reports).every(report=>fields.every(field=>report[field]===identity[field]));
const full=reports['V32_6_FULL_TEST_RESULTS.json'],coverage=reports['V32_COVERAGE_REPORT.json'],quality=reports['V32_TEST_QUALITY_AUDIT.json'],architecture=reports['V32_ARCHITECTURE_INTEGRITY.json'],mutation=reports['V32_8_STRATEGIC_MUTATION_RESULTS.json'],workflow=reports['V32_8_WORKFLOW_SECURITY.json'],intake=reports['V32_8_PINNED_ACTION_INTAKE.json'],roast=reports['V32_8_ADVERSARIAL_CLAIM_ROAST.json'],catalog=reports['V32_8_GITHUB_TOOL_CATALOG.json'],strategic=reports['V32_8_STRATEGIC_ASSURANCE.json'],summary=reports['V32_8_STRATEGIC_ADVERSARIAL_SUMMARY.json'];
const assertions={
 oneExecutionIdentity:coherent,
 fullRegressionPassed:full.status==='passed'&&full.failed===0&&full.tests>=815,
 coveragePreserved:coverage.status==='passed'&&coverage.current.linePercent>=99&&coverage.current.branchPercent>=96&&coverage.current.functionPercent>=98.5,
 qualityClean:quality.status==='passed'&&quality.criticalOrHighIssues===0&&quality.mediumIssues===0,
 architectureClosed:architecture.status==='PASS'&&architecture.metrics.closedCapabilityPathCount>=70&&architecture.metrics.sourceCycleCount===0&&architecture.metrics.untestedSourceCount===0,
 mutationsAuthentic:mutation.status==='passed'&&mutation.baseline.status==='passed'&&mutation.mutantsSpecified===14&&mutation.mutantsKilledAuthentically===14&&mutation.survivors===0&&mutation.invalidKills===0,
 workflowsImmutable:workflow.status==='PASS'&&workflow.metrics.externalActions===workflow.metrics.immutableActions&&workflow.metrics.checkoutSteps>=5,
 pinnedActionIntake:intake.status==='PASS'&&intake.approved.length===5&&intake.rejected.length===0,
 adversarialRefutationHonest:roast.status==='PASS_WITH_EXPECTED_REFUTATIONS'&&roast.localReleaseEligibleClaim.status==='PASS'&&roast.allChallengedClaims.metrics.refuted===3,
 vettedCatalogBounded:catalog.candidates.length===7&&catalog.candidates.every(row=>row.adoption==='ADAPTER_READY'&&row.executionStatus==='NOT_EXECUTED'),
 unexecutedNotMisreported:strategic.status==='READY_WITH_UNEXECUTED_GATES'&&strategic.disposition==='READY_FOR_EXTERNAL_TOOL_EXECUTION'&&strategic.unexecuted.length===5,
 productionStillBlocked:strategic.productionPromotion==='BLOCKED'&&summary.productionPromotion==='BLOCKED'&&summary.externalToolRuns===0,
};
const status=Object.values(assertions).every(Boolean)?'passed':'failed';
const report={version:'32.8',generatedAt:new Date().toISOString(),status,classification:'adversarial-strategic-assurance-safe-external-tool-adapter-readiness',...identity,assertions,results:{tests:{total:full.tests,passed:full.passed,failed:full.failed,wallDurationMs:full.wallDurationMs},coverage:coverage.current,quality:{files:quality.filesAudited,testsDeclared:quality.testsDeclared,assertCalls:quality.assertCalls},architecture:architecture.metrics,mutations:{specified:mutation.mutantsSpecified,killed:mutation.mutantsKilledAuthentically},workflow:workflow.metrics,claims:summary.claims,externalToolCandidates:catalog.candidates.length,externalToolRuns:0,strategicDisposition:strategic.disposition},readiness:'Validated Integrated Pilot — safe external assurance execution ready',productionPromotion:'blocked',externalAssuranceTools:'not executed'};
writeFileSync(join(out,'V32_8_FINAL_VALIDATION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(status!=='passed')process.exit(1);
