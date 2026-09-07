import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve('.'),out=resolve(process.env.V32_6_RUN_DIR||(process.env.V32_6_RUN_ID?join('evidence/runs',process.env.V32_6_RUN_ID):'evidence/generated'));
const identity=JSON.parse(execFileSync('python3',['scripts/test_ops_context_v32_6.py','--identity'],{cwd:root,encoding:'utf8'}));
const required=['V32_6_FULL_TEST_RESULTS.json','V32_COVERAGE_REPORT.json','V32_TEST_QUALITY_AUDIT.json','V32_ARCHITECTURE_INTEGRITY.json','V32_10_LOCAL_ASSURANCE_MUTATION_RESULTS.json','V32_10_NATIVE_SECURITY_SCAN.json','V32_10_LOCAL_SIGNED_PROVENANCE.json','V32_10_NATIVE_POLICY.json','V32_10_BOUNDED_MODEL.json','V32_10_LOCAL_FUZZ.json','V32_10_LOCAL_WITNESS.json','V32_10_LOCAL_ASSURANCE_SUMMARY.json','V32_10_EXTERNAL_PREREQUISITES.json'];
for(const name of required)if(!existsSync(join(out,name)))throw new Error(`v32_10_report_missing:${name}`);
const reports=Object.fromEntries(required.map((name)=>[name,JSON.parse(readFileSync(join(out,name),'utf8'))]));const fields=['sourceDigest','compiledArtifactDigest','testManifestDigest','testFilesDigest','packageLockDigest','environmentDigest'];const coherent=Object.values(reports).every((report)=>fields.every((field)=>report[field]===identity[field]));
const full=reports['V32_6_FULL_TEST_RESULTS.json'],coverage=reports['V32_COVERAGE_REPORT.json'],quality=reports['V32_TEST_QUALITY_AUDIT.json'],architecture=reports['V32_ARCHITECTURE_INTEGRITY.json'],mutation=reports['V32_10_LOCAL_ASSURANCE_MUTATION_RESULTS.json'],security=reports['V32_10_NATIVE_SECURITY_SCAN.json'],provenance=reports['V32_10_LOCAL_SIGNED_PROVENANCE.json'],policy=reports['V32_10_NATIVE_POLICY.json'],model=reports['V32_10_BOUNDED_MODEL.json'],fuzz=reports['V32_10_LOCAL_FUZZ.json'],witness=reports['V32_10_LOCAL_WITNESS.json'],summary=reports['V32_10_LOCAL_ASSURANCE_SUMMARY.json'],prerequisites=reports['V32_10_EXTERNAL_PREREQUISITES.json'];
const assertions={
 oneExecutionIdentity:coherent,
 fullRegressionPassed:full.status==='passed'&&full.failed===0&&full.tests>=875&&!full.lifecycleLeakDetected,
 coveragePreserved:coverage.status==='passed'&&coverage.current.linePercent>=99&&coverage.current.branchPercent>=96&&coverage.current.functionPercent>=98.5,
 qualityClean:quality.status==='passed'&&quality.criticalOrHighIssues===0&&quality.mediumIssues===0,
 architectureClosed:architecture.status==='PASS'&&architecture.metrics.closedCapabilityPathCount>=81&&architecture.metrics.sourceCycleCount===0&&architecture.metrics.untestedSourceCount===0,
 mutationsAuthentic:mutation.status==='passed'&&mutation.mutantsSpecified===12&&mutation.mutantsKilledAuthentically===12&&mutation.survivors===0&&mutation.invalidKills===0,
 nativeSarifExecuted:security.status==='PASS'&&security.evaluation.status==='PASS'&&security.scannedFiles>0,
 localSignatureVerified:provenance.signatureVerified===true&&provenance.privateKeyPersisted===false&&provenance.transparencyVerified===false,
 nativePolicyExecuted:policy.status==='PASS'&&policy.deterministic===true,
 boundedModelExecuted:model.status==='PASS'&&model.distinctStates>0&&model.invariantViolations.length===0,
 localFuzzExecuted:fuzz.status==='PASS'&&fuzz.executions>=20000&&fuzz.uniquePaths>=2&&fuzz.crashes===0&&fuzz.deterministicReplay===true,
 localWitnessExecuted:witness.status==='PASS'&&witness.entries===5&&witness.classification==='LOCAL_SINGLE_HOST_WITNESS_EXTERNAL_INDEPENDENCE_REQUIRED',
 truthBoundaryPreserved:summary.status==='PASS_WITH_EXTERNAL_BLOCKERS'&&summary.externalToolRuns===0&&summary.productionPromotion==='BLOCKED'&&summary.externalBlockers.length>=7,
 administratorBoundaryExplicit:prerequisites.status==='ADMIN_ACTION_REQUIRED'&&prerequisites.secretValuesRecorded===false&&prerequisites.productionPromotion==='BLOCKED'
};
const status=Object.values(assertions).every(Boolean)?'passed':'failed';const report={version:'32.10',generatedAt:new Date().toISOString(),status,classification:'local-execution-assurance-with-external-blockers',...identity,assertions,results:{tests:{total:full.tests,passed:full.passed,failed:full.failed,wallDurationMs:full.wallDurationMs},coverage:coverage.current,quality:{files:quality.filesAudited,testsDeclared:quality.testsDeclared,assertCalls:quality.assertCalls},architecture:architecture.metrics,mutations:mutation.mutantsKilledAuthentically,localExecution:{securityFindings:security.metrics?.findings??security.evaluation.metrics.findings,signatureVerified:provenance.signatureVerified,policy:policy.status,modelStates:model.distinctStates,fuzzExecutions:fuzz.executions,fuzzPaths:fuzz.uniquePaths,witnessEntries:witness.entries,administratorInputsReady:prerequisites.adminInputs.filter((row)=>row.ready).length}},readiness:'Validated Integrated Pilot — six local assurance lanes executed',productionPromotion:'blocked',externalQualification:'not executed',administratorActionsRequired:summary.externalBlockers};
writeFileSync(join(out,'V32_10_FINAL_VALIDATION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(status!=='passed')process.exit(1);
