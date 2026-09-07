import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
const root=resolve('.');const out=resolve(process.env.V32_6_RUN_DIR||'evidence/generated');
const identity=JSON.parse(execFileSync('python3',['scripts/test_ops_context_v32_6.py','--identity'],{cwd:root,encoding:'utf8'}));
const required=['V32_6_TEST_OPERATIONS_FINAL_VALIDATION.json','V32_COVERAGE_REPORT.json','V32_ARCHITECTURE_INTEGRITY.json','V32_7_PROOF_INTEGRATION_MUTATION_RESULTS.json','V32_7_PROOF_DIVERSITY.json','V32_7_INTEGRATION_CONTRACTS.json','V32_7_INTEGRATION_FAULT_CAMPAIGN.json','V32_7_RELEASE_ASSURANCE.json','V32_7_PARAMETER_STRENGTHENING.json','V32_7_PROOF_INTEGRATION_SUMMARY.json'];
for(const name of required)if(!existsSync(join(out,name)))throw new Error(`v32_7_report_missing:${name}`);
const json=(name)=>JSON.parse(readFileSync(join(out,name),'utf8'));const reports=Object.fromEntries(required.map((name)=>[name,json(name)]));
const fields=['sourceDigest','compiledArtifactDigest','testManifestDigest','testFilesDigest','packageLockDigest','environmentDigest'];
const coherent=Object.values(reports).every((report)=>fields.every((field)=>report[field]===undefined||report[field]===identity[field]));
const base=reports['V32_6_TEST_OPERATIONS_FINAL_VALIDATION.json'],coverage=reports['V32_COVERAGE_REPORT.json'],architecture=reports['V32_ARCHITECTURE_INTEGRITY.json'],mutation=reports['V32_7_PROOF_INTEGRATION_MUTATION_RESULTS.json'],proof=reports['V32_7_PROOF_DIVERSITY.json'],integration=reports['V32_7_INTEGRATION_CONTRACTS.json'],faults=reports['V32_7_INTEGRATION_FAULT_CAMPAIGN.json'],release=reports['V32_7_RELEASE_ASSURANCE.json'],strength=reports['V32_7_PARAMETER_STRENGTHENING.json'],summary=reports['V32_7_PROOF_INTEGRATION_SUMMARY.json'];
const assertions={
 allReportsOneIdentity:coherent,
 scalableTestOperationsPassed:base.status==='passed'&&base.results.tests.full>=779,
 coveragePreserved:coverage.status==='passed'&&coverage.current.linePercent>=99&&coverage.current.branchPercent>=96&&coverage.current.functionPercent>=98.5,
 architectureExpanded:architecture.status==='PASS'&&architecture.metrics.closedCapabilityPathCount>=61&&architecture.metrics.sourceCycleCount===0&&architecture.metrics.untestedSourceCount===0,
 mutationAuthentic:mutation.status==='passed'&&mutation.baseline.status==='passed'&&mutation.mutantsSpecified===mutation.mutantsKilledAuthentically&&mutation.survivors===0&&mutation.invalidKills===0,
 proofDiversityClosed:proof.status==='PASS'&&proof.metrics.closedClaims===proof.metrics.claims&&proof.metrics.distinctTechniques>=8,
 integrationsClosed:integration.status==='PASS'&&integration.metrics.closedEdges===integration.metrics.edges&&integration.metrics.authorityCycles===0,
 faultsClosed:faults.status==='PASS'&&faults.metrics.missingScenarios===0&&faults.metrics.unsafeSideEffects===0&&faults.metrics.tenantLeaks===0,
 releaseBoundaryHonest:release.status==='PASS_WITH_EXTERNAL_BLOCKERS'&&release.localDisposition==='READY_FOR_EXTERNAL_QUALIFICATION'&&release.productionPromotion==='BLOCKED'&&release.externalBlockers.length===6,
 parametersStrengthened:strength.status==='PASS'&&strength.dimensions.length>=8&&strength.dimensions.every((row)=>row.delta>0),
 summaryPassed:summary.status==='PASS',
};
const status=Object.values(assertions).every(Boolean)?'passed':'failed';
const report={version:'32.7',generatedAt:new Date().toISOString(),status,classification:'proof-depth-integration-stress-and-release-decision-closure',...identity,assertions,results:{tests:base.results.tests,coverage:coverage.current,architecture:architecture.metrics,mutations:{specified:mutation.mutantsSpecified,killed:mutation.mutantsKilledAuthentically},proofs:proof.metrics,integrations:integration.metrics,faults:faults.metrics,strengthenedParameters:strength.dimensions,release:{status:release.status,localDisposition:release.localDisposition,productionPromotion:release.productionPromotion,externalBlockers:release.externalBlockers}},readiness:'Validated Integrated Pilot — deeper proof diversity and integration closure',productionPromotion:'blocked',externalQualification:'not executed'};
writeFileSync(join(out,'V32_7_FINAL_VALIDATION.json'),`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report,null,2));if(status!=='passed')process.exit(1);
