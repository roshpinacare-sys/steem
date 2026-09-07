import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { evaluateExecutionLedger } from '../dist/src/validation/execution-ledger-assurance.js';
import { loadGovernanceBundle, validateGovernanceBundle } from '../dist/src/governance/consistency.js';

const root=resolve('.');
const out=resolve(process.env.V32_6_RUN_DIR || (process.env.V32_6_RUN_ID ? join('evidence/runs',process.env.V32_6_RUN_ID) : 'evidence/generated'));
const runId=basename(out); const read=(name)=>JSON.parse(readFileSync(join(out,name),'utf8'));
const identity=JSON.parse(execFileSync('python3',['scripts/test_ops_context_v32_6.py','--identity'],{cwd:root,encoding:'utf8'}));
const ledger=read('V32_17_EXECUTION_LEDGER.json');
const requiredSteps=[
 ['repository-truth-map','V32_17_REPOSITORY_TRUTH_MAP.json'],['clean-build','V32_17_BUILD_IDENTITY.json'],['full-regression','V32_6_FULL_TEST_RESULTS.json'],
 ['local-assurance-mutation-v32.10','V32_10_LOCAL_ASSURANCE_MUTATION_RESULTS.json'],['execution-ledger-mutation-v32.11','V32_11_EXECUTION_LEDGER_MUTATION_RESULTS.json'],
 ['external-integrity-mutation-v32.12','V32_12_EXTERNAL_INTEGRITY_MUTATION_RESULTS.json'],['sovereign-efficiency-proof-v32.13','V32_13_SOVEREIGN_EFFICIENCY_PROOF.json'],
 ['sovereign-efficiency-mutation-v32.13','V32_13_SOVEREIGN_EFFICIENCY_MUTATION_RESULTS.json'],['frontier-binary-proof-v32.14','V32_14_FRONTIER_BINARY_PROOF.json'],
 ['binary-fuzz-v32.14','V32_14_BINARY_FUZZ_REPORT.json'],['frontier-binary-mutation-v32.14','V32_14_FRONTIER_BINARY_MUTATION_RESULTS.json'],
 ['frontier-tournament-wasm-proof-v32.15',['V32_15_FRONTIER_TOURNAMENT_WASM_PROOF.json','V32_15_FRONTIER_TOURNAMENT_WASM_BUNDLE.json']],
 ['frontier-tournament-wasm-mutation-v32.15','V32_15_FRONTIER_TOURNAMENT_WASM_MUTATION_RESULTS.json'],
 ['runtime-external-failover-proof-v32.16',['V32_16_RUNTIME_EXTERNAL_FAILOVER_PROOF.json','V32_16_RUNTIME_EXTERNAL_FAILOVER_BUNDLE.json']],
 ['runtime-external-failover-mutation-v32.16','V32_16_RUNTIME_EXTERNAL_FAILOVER_MUTATION_RESULTS.json'],
 ['cncf-sovereign-convergence-proof-v32.17',['V32_17_CNCF_SOVEREIGN_CONVERGENCE_PROOF.json','V32_17_CNCF_SOVEREIGN_CONVERGENCE_BUNDLE.json']],
 ['cncf-sovereign-convergence-mutation-v32.17','V32_17_CNCF_SOVEREIGN_CONVERGENCE_MUTATION_RESULTS.json'],
 ['coverage',['V32_COVERAGE_REPORT.json','V32_COVERAGE_SCOPE.json']],['test-quality','V32_TEST_QUALITY_AUDIT.json'],
 ['architecture','V32_ARCHITECTURE_INTEGRITY.json'],['external-readiness','V32_12_EXTERNAL_QUALIFICATION_READINESS.json'],
].map(([id,artifact])=>({id,artifacts:Array.isArray(artifact)?artifact:[artifact]}));
const observations=ledger.steps.flatMap((step)=>step.artifacts.map((artifact)=>{const absolute=resolve(root,artifact.path),bytes=readFileSync(absolute),stat=statSync(absolute);return{path:artifact.path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,modifiedAt:stat.mtime.toISOString()};}));
const ledgerAssurance=evaluateExecutionLedger({ledger,expectedVersion:'32.17',expectedRunId:runId,expectedSourceDigest:identity.sourceDigest,expectedRunPrefix:`evidence/runs/${runId}`,requiredSteps,observations,now:new Date().toISOString(),maximumRunAgeMs:14_400_000});
const governance=validateGovernanceBundle(loadGovernanceBundle(resolve(root,'governance-state')),root);
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8')),lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
const full=read('V32_6_FULL_TEST_RESULTS.json'),m10=read('V32_10_LOCAL_ASSURANCE_MUTATION_RESULTS.json'),m11=read('V32_11_EXECUTION_LEDGER_MUTATION_RESULTS.json'),m12=read('V32_12_EXTERNAL_INTEGRITY_MUTATION_RESULTS.json'),m13=read('V32_13_SOVEREIGN_EFFICIENCY_MUTATION_RESULTS.json'),m14=read('V32_14_FRONTIER_BINARY_MUTATION_RESULTS.json'),m15=read('V32_15_FRONTIER_TOURNAMENT_WASM_MUTATION_RESULTS.json'),m16=read('V32_16_RUNTIME_EXTERNAL_FAILOVER_MUTATION_RESULTS.json'),m17=read('V32_17_CNCF_SOVEREIGN_CONVERGENCE_MUTATION_RESULTS.json');
const proof16=read('V32_16_RUNTIME_EXTERNAL_FAILOVER_PROOF.json'),proof17=read('V32_17_CNCF_SOVEREIGN_CONVERGENCE_PROOF.json'),coverage=read('V32_COVERAGE_REPORT.json'),quality=read('V32_TEST_QUALITY_AUDIT.json'),architecture=read('V32_ARCHITECTURE_INTEGRITY.json'),truth=read('V32_17_REPOSITORY_TRUTH_MAP.json'),readiness=read('V32_12_EXTERNAL_QUALIFICATION_READINESS.json');
const oldMutation=(r,n)=>r.status==='passed'&&r.mutantsSpecified===n&&r.mutantsKilledAuthentically===n&&r.survivors===0&&r.invalidKills===0;
const simpleMutation=(r,n)=>r.status==='passed'&&r.total===n&&r.killed===n&&r.survived===0&&r.invalid===0;
const summary=coverage.current??coverage.coverage?.total??coverage.total??{};const pct=(key)=>Number(summary[{lines:'linePercent',branches:'branchPercent',functions:'functionPercent'}[key]]??summary[key]?.pct??0);
const assertions={
 ledgerFreshAndCoherent:ledgerAssurance.status==='PASS',
 exactGovernanceLineage:governance.ok&&governance.version==='32.17',
 releaseMetadataCurrent:pkg.version==='0.25.0'&&lock.version==='0.25.0'&&lock.packages?.['']?.version==='0.25.0'&&/v32\.17/i.test(pkg.description??''),
 fullRegressionExpanded:full.status==='passed'&&full.failed===0&&(full.skipped??0)===0&&full.tests>=1100,
 mutationsAuthentic:oldMutation(m10,12)&&oldMutation(m11,9)&&oldMutation(m12,24)&&oldMutation(m13,15)&&oldMutation(m14,19)&&simpleMutation(m15,17)&&simpleMutation(m16,11)&&simpleMutation(m17,25),
 coverageThresholdsPreserved:coverage.status==='passed'&&pct('lines')>=99&&pct('branches')>=96&&pct('functions')>=98.5,
 testQualityPassed:quality.status==='passed'&&quality.criticalOrHighIssues===0&&quality.mediumIssues===0,
 architecturePassed:architecture.status==='PASS'&&architecture.capabilityClosure?.length>=97&&architecture.capabilityClosure.every((path)=>path.status==='CLOSED')&&architecture.sourceCycles?.length===0&&architecture.untestedSources?.length===0,
 truthMapPassed:truth.status==='passed'&&truth.inventory?.externalQualificationKits===6&&truth.inventory?.frontierBenchmarkKits>=1&&truth.inventory?.independentVerifierFiles>=3&&!truth.findings?.some((finding)=>finding.status==='open'),
 wasmRuntimeObserved:proof16.status==='passed'&&proof16.wasmRuntime?.state==='DRY_RUN_PASSED'&&proof16.wasmRuntime?.memoryBytes>0&&proof16.wasmRuntime?.productionQualified===false,
 transportTrustObserved:proof16.transport?.state==='DRY_RUN_PASSED'&&proof16.transport?.externallyObserved===false,
 failoverObserved:proof16.failover?.state==='DRY_RUN_PASSED'&&proof16.failover?.requestsCompleted===1000&&proof16.failover?.rpoWrites===0&&proof16.failover?.childProcessesCleaned===true&&proof16.failover?.productionQualified===false,
 independentVerifierPassed:proof16.independentVerifier?.status==='passed',
 cncfConvergencePassed:proof17.state==='DRY_RUN_PASSED'&&proof17.productionQualified===false&&proof17.buildingBlocksCovered===8&&proof17.buildingBlocksRequired===8&&proof17.interoperabilityEquivalent===true&&proof17.vendorSubstitutionCoverage===1&&proof17.operationalReductionRate>=0.5&&proof17.normalizedCostReductionRate>=0.6,
 externalReadinessHonest:readiness.status==='READY'&&readiness.gatesReady===6&&readiness.gatesTotal===6&&readiness.externalQualification==='not_executed'&&readiness.productionPromotion==='blocked'&&readiness.gates.every((gate)=>gate.productionQualified===false),
};
const status=Object.values(assertions).every(Boolean)?'passed':'failed';
const report={version:'32.17',runId,generatedAt:new Date().toISOString(),status,classification:'cncf-sovereign-building-block-convergence-integrated-pilot',...identity,assertions,ledgerAssurance,governanceFindings:governance.findings,results:{tests:{total:full.tests,passed:full.passed,failed:full.failed,skipped:full.skipped??0,testFiles:full.files??full.testFiles},mutations:{localAssurance:12,executionLedger:9,externalIntegrity:24,sovereignEfficiency:15,frontierBinary:19,frontierTournamentWasm:17,runtimeExternalFailover:11,cncfSovereignConvergence:25,total:132},coverage:{lines:pct('lines'),branches:pct('branches'),functions:pct('functions')},architecture:{capabilityPaths:architecture.capabilityClosure?.length??0,closedPaths:architecture.capabilityClosure?.filter((path)=>path.status==='CLOSED').length??0,sourceCycles:architecture.sourceCycles?.length??0,untestedSources:architecture.untestedSources?.length??0},runtime:{wasm:proof16.wasmRuntime,transport:proof16.transport,failover:proof16.failover}},readiness:'CNCF Sovereign Building-Block Convergence Integrated Pilot — External Qualification Ready',productionPromotion:'blocked',externalQualification:'not_executed',proofClasses:{currentExecution:['clean build','full regression','eight mutation portfolios','coverage','test quality','architecture','repository truth map','bounded WASM worker execution','signed independent transport dry run','two-process HTTP failover','independent Python report verification','CNCF component admission','portable building-block trace equivalence','topology consolidation and substitution proof'],syntheticOnly:['provider transport fixture','local signing identities','Dapr-envelope compatibility adapter','normalized cost and operational baselines'],notExecuted:readiness.gates.map((gate)=>gate.gateId)},limitations:['Actual Dapr SPIRE OPA OpenTelemetry Wasmtime and CloudNativePG runtimes were not executed in this offline environment.','Local portable adapters do not establish independent-organization runtime equivalence.','Node Worker WebAssembly execution is not a qualified WASI Component Model runtime.','Local observer fixtures do not establish provider API transport from an external organization.','Two processes on one machine do not establish independent-host or provider failover.','The six external qualification gates were not executed.']};
writeFileSync(join(out,'V32_17_FINAL_VALIDATION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(status!=='passed')process.exit(1);
