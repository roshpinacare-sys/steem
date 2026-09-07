import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateChangeImpact } from '../src/governance/change-impact-gate.js';
import { checkInvariantModel } from '../src/validation/invariant-model-checker.js';
import { planAdversarialCoverage, type AdversarialTechnique } from '../src/validation/adversarial-test-planner.js';
import { analyzeTrustBlastRadius } from '../src/security/trust-blast-radius.js';
import { evaluateCrashConsistency } from '../src/platform/crash-consistency-matrix.js';
import { evaluateArchitectureEntropy } from '../src/validation/architecture-entropy.js';
import { evaluateClaimEvidenceClosure } from '../src/platform/claim-evidence-closure.js';
import { evaluateProductPathBenchmarks } from '../src/operations/product-path-benchmark.js';
import { compareReproducibilityCapsules } from '../src/validation/reproducibility-capsule.js';
import { evaluateRecoveryGameDay } from '../src/operations/recovery-game-day.js';
import { evaluatePortabilityMatrix } from '../src/supply-chain/portability-matrix.js';
import { evaluateOperatorTaskFlows } from '../src/product/operator-task-flow.js';
import { buildQualificationExecutionPlan } from '../src/qualification/qualification-execution-plan.js';
import { buildChangeVerificationPlan } from '../src/validation/change-verification-plan.js';

const digest = 'a'.repeat(64);

test('requirement fidelity change gate accepts complete bounded critical changes', () => {
  const report = evaluateChangeImpact([{ artifactId:'src/a.ts', criticality:'critical', requirementRefs:['REQ-1'], ownerIds:['owner'], testRefs:['tests/a.test.ts'], evidenceRefs:['evidence/a.json'], rollbackRef:'git-revert:1', reviewerIds:['r1','r2'] }]);
  assert.equal(report.status,'PASS'); assert.equal(report.metrics.ready,1); assert.match(report.reportDigest,/^[0-9a-f]{64}$/);
});
test('requirement fidelity change gate blocks missing proof and conflicts', () => {
  const report = evaluateChangeImpact([{ artifactId:'a', criticality:'critical', requirementRefs:[], ownerIds:['owner'], testRefs:[], evidenceRefs:[], reviewerIds:['owner'] }]);
  assert.equal(report.status,'BLOCK'); assert.deepEqual(report.results[0]!.reasons,['requirement_missing','test_missing','evidence_missing','rollback_missing','independent_reviewers_insufficient','owner_reviewer_conflict']);
  assert.throws(()=>evaluateChangeImpact([{ artifactId:'', criticality:'low', requirementRefs:[], ownerIds:[], testRefs:[], evidenceRefs:[], reviewerIds:[] }]),/identity/);
});

test('invariant checker verifies legal monotonic trace', () => {
  const report=checkInvariantModel({initialState:'NEW',transitions:[{from:'NEW',event:'approve',to:'APPROVED'},{from:'APPROVED',event:'execute',to:'DONE'}],trace:[{eventId:'1',event:'approve',resultingState:'APPROVED',monotonicValue:1},{eventId:'2',event:'execute',resultingState:'DONE',monotonicValue:2}],terminalStates:['DONE']});
  assert.equal(report.status,'PASS'); assert.equal(report.finalState,'DONE'); assert.equal(report.metrics.terminalReached,true);
});
test('invariant checker catches duplicate, regression and illegal transition', () => {
  const report=checkInvariantModel({initialState:'NEW',transitions:[{from:'NEW',event:'approve',to:'APPROVED'}],trace:[{eventId:'1',event:'approve',resultingState:'WRONG',monotonicValue:1},{eventId:'1',event:'execute',resultingState:'DONE',monotonicValue:1}],terminalStates:['DONE']});
  assert.equal(report.status,'BLOCK'); assert.ok(report.violations.some(v=>v.startsWith('duplicate_event'))); assert.ok(report.violations.some(v=>v.startsWith('monotonic_regression'))); assert.ok(report.violations.some(v=>v.startsWith('transition_not_allowed'))); assert.ok(report.violations.some(v=>v.startsWith('result_state_mismatch')));
  assert.throws(()=>checkInvariantModel({initialState:'',transitions:[],trace:[],terminalStates:[]}),/initial_state/);
});

const allTechniques: AdversarialTechnique[]=['boundary','mutation','concurrency','replay','tamper','timeout','resource-exhaustion','state-machine'];
test('adversarial planner requires complete critical technique portfolio',()=>{const r=planAdversarialCoverage([{targetId:'trust',criticality:'critical',coveredTechniques:allTechniques,testRefs:['t']}]);assert.equal(r.status,'PASS');assert.equal(r.metrics.coveragePercent,100);});
test('adversarial planner exposes missing techniques and malformed targets',()=>{const r=planAdversarialCoverage([{targetId:'x',criticality:'critical',coveredTechniques:['boundary','mutation','state-machine'],testRefs:['t']}]);assert.equal(r.status,'BLOCK');assert.deepEqual(r.results[0]!.missingTechniques,['concurrency','replay','tamper','timeout','resource-exhaustion']);assert.throws(()=>planAdversarialCoverage([{targetId:'x',criticality:'normal',coveredTechniques:['boundary','boundary'],testRefs:['t']}]),/coverage_invalid/);});

test('trust blast radius stays bounded for revocable scoped grants',()=>{const r=analyzeTrustBlastRadius([{grantId:'g',custodianId:'c',tenantIds:['t1'],scopes:['sign'],expiresAt:'2030-01-01T00:00:00Z',revocable:true}],['c'],'2026-01-01T00:00:00Z');assert.equal(r.status,'PASS');assert.equal(r.metrics.affectedTenants,1);});
test('trust blast radius blocks wildcard and non-revocable concentration',()=>{const r=analyzeTrustBlastRadius([{grantId:'g1',custodianId:'c',tenantIds:['*'],scopes:['*'],expiresAt:'2030-01-01T00:00:00Z',revocable:false},{grantId:'g2',custodianId:'c',tenantIds:['t'],scopes:['s'],expiresAt:'2030-01-01T00:00:00Z',revocable:true}],['c'],'2026-01-01T00:00:00Z');assert.equal(r.status,'BLOCK');assert.equal(r.findings.length,3);assert.throws(()=>analyzeTrustBlastRadius([],[],'bad'),/time_invalid/);});

test('crash consistency matrix covers all publication points',()=>{const r=evaluateCrashConsistency([{scenarioId:'1',crashPoint:'before-private-write',recoveredState:'prior',duplicateSideEffect:false,testRef:'t1'},{scenarioId:'2',crashPoint:'after-private-fsync',recoveredState:'prior',duplicateSideEffect:false,testRef:'t2'},{scenarioId:'3',crashPoint:'after-atomic-publish',recoveredState:'committed',duplicateSideEffect:false,testRef:'t3'},{scenarioId:'4',crashPoint:'after-ack',recoveredState:'committed',duplicateSideEffect:false,testRef:'t4'}]);assert.equal(r.status,'PASS');assert.equal(r.metrics.crashPointsCovered,4);});
test('crash consistency matrix catches partial, duplicates and missing points',()=>{const r=evaluateCrashConsistency([{scenarioId:'1',crashPoint:'before-private-write',recoveredState:'partial',duplicateSideEffect:true,testRef:'t'}]);assert.equal(r.status,'BLOCK');assert.ok(r.findings.includes('unsafe_recovery:1'));assert.ok(r.findings.includes('duplicate_side_effect:1'));assert.ok(r.findings.some(v=>v.startsWith('crash_point_missing')));assert.throws(()=>evaluateCrashConsistency([{scenarioId:'',crashPoint:'after-ack',recoveredState:'committed',duplicateSideEffect:false,testRef:''}]),/scenario_invalid/);});

test('architecture entropy passes acyclic single-authority graph',()=>{const r=evaluateArchitectureEntropy({sourceModules:100,dependencyEdges:500,cycles:0,layerViolations:0,authorityImplementations:[{authority:'runtime',implementationIds:['one']}],untestedModules:0});assert.equal(r.status,'PASS');assert.equal(r.score,100);});
test('architecture entropy blocks cycles, violations and duplicate authority',()=>{const r=evaluateArchitectureEntropy({sourceModules:10,dependencyEdges:100,cycles:1,layerViolations:1,authorityImplementations:[{authority:'runtime',implementationIds:['a','b']}],untestedModules:1});assert.equal(r.status,'BLOCK');assert.ok(r.findings.includes('cycles:1'));assert.ok(r.findings.includes('edge_density_high:10'));assert.throws(()=>evaluateArchitectureEntropy({sourceModules:0,dependencyEdges:0,cycles:0,layerViolations:0,authorityImplementations:[],untestedModules:0}),/input_invalid/);});

test('claim evidence closure validates complete transitive claim graph',()=>{const r=evaluateClaimEvidenceClosure([{claimId:'base',dependsOnClaimIds:[],evidenceIds:['e1'],limitationIds:['local']},{claimId:'top',dependsOnClaimIds:['base'],evidenceIds:['e2'],limitationIds:[]}],[{evidenceId:'e1',current:true,authentic:true,complete:true},{evidenceId:'e2',current:true,authentic:true,complete:true}]);assert.equal(r.status,'PASS');assert.deepEqual(r.results[1]!.inheritedLimitations,['local']);});
test('claim evidence closure rejects cycles, stale and missing evidence',()=>{const r=evaluateClaimEvidenceClosure([{claimId:'a',dependsOnClaimIds:['b'],evidenceIds:['missing'],limitationIds:[]},{claimId:'b',dependsOnClaimIds:['a'],evidenceIds:['stale'],limitationIds:[]}],[{evidenceId:'stale',current:false,authentic:false,complete:false}]);assert.equal(r.status,'BLOCK');assert.ok(r.results.flatMap(x=>x.reasons).some(v=>v.startsWith('evidence_missing')));assert.ok(r.results.flatMap(x=>x.reasons).some(v=>v.startsWith('evidence_stale')));assert.throws(()=>evaluateClaimEvidenceClosure([{claimId:'',dependsOnClaimIds:[],evidenceIds:[],limitationIds:[]}],[]),/identity_invalid/);});

test('product path benchmark enforces p95 throughput heap and samples',()=>{const r=evaluateProductPathBenchmarks([{pathId:'p',maximumP95Ms:10,minimumThroughputPerSecond:100,maximumHeapDeltaBytes:1000,minimumSamples:3}],[{pathId:'p',latencyMs:[1,2,3],throughputPerSecond:500,heapDeltaBytes:100,environment:'local-single-host'}]);assert.equal(r.status,'PASS');assert.equal(r.results[0]!.p95Ms,3);});
test('product path benchmark blocks missing and exceeded observations',()=>{const missing=evaluateProductPathBenchmarks([{pathId:'p',maximumP95Ms:1,minimumThroughputPerSecond:100,maximumHeapDeltaBytes:1,minimumSamples:3}],[]);assert.equal(missing.status,'BLOCK');const r=evaluateProductPathBenchmarks([{pathId:'p',maximumP95Ms:1,minimumThroughputPerSecond:100,maximumHeapDeltaBytes:1,minimumSamples:3}],[{pathId:'p',latencyMs:[2],throughputPerSecond:1,heapDeltaBytes:2,environment:'qualified-multi-host'}]);assert.equal(r.results[0]!.reasons.length,4);assert.throws(()=>evaluateProductPathBenchmarks([{pathId:'',maximumP95Ms:0,minimumThroughputPerSecond:0,maximumHeapDeltaBytes:-1,minimumSamples:0}],[]),/budget_invalid/);});

test('reproducibility capsule matches all deterministic inputs',()=>{const c={sourceDigest:digest,artifactDigest:digest,seed:'42',clockMode:'fixed' as const,timezone:'UTC',locale:'C',runtimeVersions:{node:'22'},environmentAllowlist:['CI']};const r=compareReproducibilityCapsules(c,{...c,environmentAllowlist:['CI']});assert.equal(r.status,'PASS');assert.match(r.capsuleDigest,/^[0-9a-f]{64}$/);});
test('reproducibility capsule identifies field runtime and environment drift',()=>{const a={sourceDigest:digest,artifactDigest:digest,seed:'1',clockMode:'fixed' as const,timezone:'UTC',locale:'C',runtimeVersions:{node:'22'},environmentAllowlist:['A']};const b={...a,seed:'2',clockMode:'monotonic' as const,runtimeVersions:{node:'23'},environmentAllowlist:['B']};const r=compareReproducibilityCapsules(a,b);assert.equal(r.status,'BLOCK');assert.ok(r.mismatches.includes('field_mismatch:seed'));assert.ok(r.mismatches.includes('runtime_mismatch:node'));assert.ok(r.mismatches.includes('environment_allowlist_mismatch'));assert.throws(()=>compareReproducibilityCapsules({...a,sourceDigest:'x'},b),/capsule_invalid/);});

test('recovery game day requires detection containment recovery recertification',()=>{const r=evaluateRecoveryGameDay([{scenarioId:'db',detected:true,contained:true,recovered:true,recertified:true,detectionMinutes:1,recoveryMinutes:4,rtoMinutes:5,evidenceRefs:['e']}]);assert.equal(r.status,'PASS');assert.equal(r.metrics.worstRecoveryMinutes,4);});
test('recovery game day blocks missing controls and RTO breach',()=>{const r=evaluateRecoveryGameDay([{scenarioId:'db',detected:false,contained:false,recovered:false,recertified:false,detectionMinutes:1,recoveryMinutes:10,rtoMinutes:5,evidenceRefs:[]}]);assert.equal(r.status,'BLOCK');assert.equal(r.results[0]!.reasons.length,6);assert.throws(()=>evaluateRecoveryGameDay([{scenarioId:'',detected:true,contained:true,recovered:true,recertified:true,detectionMinutes:-1,recoveryMinutes:0,rtoMinutes:0,evidenceRefs:[]}]),/scenario_invalid/);});

test('portability matrix passes observed target while preserving planned targets',()=>{const r=evaluatePortabilityMatrix([{targetId:'linux-x64',operatingSystem:'linux',architecture:'x64',runtime:'node22',build:'PASS',tests:'PASS',archiveSelfTest:'PASS',observed:true},{targetId:'mac-arm',operatingSystem:'macos',architecture:'arm64',runtime:'node22',build:'NOT_RUN',tests:'NOT_RUN',archiveSelfTest:'NOT_RUN',observed:false}]);assert.equal(r.status,'PASS');assert.equal(r.metrics.plannedTargets,1);assert.equal(r.results[1]!.qualified,false);});
test('portability matrix blocks failed observed target and malformed identity',()=>{const r=evaluatePortabilityMatrix([{targetId:'x',operatingSystem:'linux',architecture:'x64',runtime:'node',build:'FAIL',tests:'PASS',archiveSelfTest:'PASS',observed:true}]);assert.equal(r.status,'BLOCK');assert.deepEqual(r.results[0]!.reasons,['build_fail']);assert.throws(()=>evaluatePortabilityMatrix([{targetId:'',operatingSystem:'linux',architecture:'x64',runtime:'',build:'PASS',tests:'PASS',archiveSelfTest:'PASS',observed:true}]),/target_invalid/);});

test('operator flow measures step reduction with guarded recovery',()=>{const r=evaluateOperatorTaskFlows([{flowId:'approve',baselineSteps:8,criticalErrorOpportunities:2,steps:[{stepId:'1',action:'review',decisionRequired:true,irreversible:false,confirmation:false,recoveryAvailable:true,automated:false},{stepId:'2',action:'approve',decisionRequired:true,irreversible:true,confirmation:true,recoveryAvailable:true,automated:false}]}]);assert.equal(r.status,'PASS');assert.equal(r.metrics.averageStepReductionPercent,75);});
test('operator flow blocks unguarded irreversible actions and expansion',()=>{const steps=[{stepId:'1',action:'delete',decisionRequired:true,irreversible:true,confirmation:false,recoveryAvailable:false,automated:false},{stepId:'2',action:'extra',decisionRequired:false,irreversible:false,confirmation:false,recoveryAvailable:true,automated:false}];const r=evaluateOperatorTaskFlows([{flowId:'f',baselineSteps:1,criticalErrorOpportunities:1,steps}]);assert.equal(r.status,'BLOCK');assert.equal(r.results[0]!.reasons.length,3);assert.throws(()=>evaluateOperatorTaskFlows([{flowId:'',baselineSteps:0,criticalErrorOpportunities:-1,steps:[]}]),/flow_invalid/);});

test('qualification execution plan topologically schedules independent reviewers',()=>{const r=buildQualificationExecutionPlan([{gateId:'a',prerequisiteGateIds:[],collectorId:'c1',reviewerId:'r1',commandRef:'cmd',evidencePath:'e/a',rollbackRef:'rb',estimatedMinutes:10},{gateId:'b',prerequisiteGateIds:['a'],collectorId:'c2',reviewerId:'r2',commandRef:'cmd',evidencePath:'e/b',rollbackRef:'rb',estimatedMinutes:20}]);assert.equal(r.status,'READY');assert.deepEqual(r.waves,[['a'],['b']]);assert.equal(r.metrics.totalEstimatedMinutes,30);});
test('qualification execution plan blocks conflicts missing prerequisites and cycles',()=>{const r=buildQualificationExecutionPlan([{gateId:'a',prerequisiteGateIds:['b'],collectorId:'same',reviewerId:'same',commandRef:'c',evidencePath:'e',rollbackRef:'r',estimatedMinutes:1},{gateId:'b',prerequisiteGateIds:['a','missing'],collectorId:'c',reviewerId:'r',commandRef:'c',evidencePath:'e',rollbackRef:'r',estimatedMinutes:1}]);assert.equal(r.status,'BLOCK');assert.ok(r.findings.some(v=>v.startsWith('collector_reviewer_conflict')));assert.ok(r.findings.some(v=>v.startsWith('prerequisite_missing')));assert.ok(r.findings.includes('qualification_dependency_cycle'));assert.throws(()=>buildQualificationExecutionPlan([{gateId:'',prerequisiteGateIds:[],collectorId:'c',reviewerId:'r',commandRef:'',evidencePath:'',rollbackRef:'',estimatedMinutes:0}]),/gate_invalid/);});

test('change verification plan maps impact and forces full suite for critical change',()=>{const r=buildChangeVerificationPlan({changedFiles:['src/security/a.ts','README.md'],mappings:[{sourcePattern:'src/security/**',capabilityIds:['trust'],testRefs:['tests/trust.test.ts'],critical:true},{sourcePattern:'README.md',capabilityIds:['docs'],testRefs:['tests/governance.test.ts'],critical:false}],fullSuiteRef:'npm test'});assert.equal(r.status,'PASS');assert.equal(r.metrics.fullSuiteRequired,true);assert.ok(r.selectedTests.includes('npm test'));});
test('change verification plan blocks unmapped changes and bad patterns',()=>{const r=buildChangeVerificationPlan({changedFiles:['unknown'],mappings:[],fullSuiteRef:'all'});assert.equal(r.status,'BLOCK');assert.deepEqual(r.unmappedFiles,['unknown']);assert.throws(()=>buildChangeVerificationPlan({changedFiles:[''],mappings:[],fullSuiteRef:'all'}),/changed_file_invalid/);assert.throws(()=>buildChangeVerificationPlan({changedFiles:['x'],mappings:[{sourcePattern:'',capabilityIds:[],testRefs:[],critical:false}],fullSuiteRef:'all'}),/pattern_invalid/);});

test('axis coverage matrix exercises low-risk changes and duplicate change identities',()=>{
  const low=evaluateChangeImpact([{artifactId:'doc',criticality:'low',requirementRefs:['r'],ownerIds:[],testRefs:['t'],evidenceRefs:['e'],reviewerIds:[]}]);
  assert.equal(low.status,'BLOCK'); assert.deepEqual(low.results[0]!.reasons,['owner_missing']);
  assert.throws(()=>evaluateChangeImpact([{artifactId:'x',criticality:'low',requirementRefs:['r'],ownerIds:['o'],testRefs:['t'],evidenceRefs:['e'],reviewerIds:['r']},{artifactId:'x',criticality:'medium',requirementRefs:['r'],ownerIds:['o'],testRefs:['t'],evidenceRefs:['e'],reviewerIds:['r']}]),/identity_invalid/);
});

test('adversarial planner covers normal, empty, duplicate and blank-reference branches',()=>{
  const normal=planAdversarialCoverage([{targetId:'n',criticality:'normal',coveredTechniques:['boundary','mutation','state-machine'],testRefs:['t']}]);
  assert.equal(normal.status,'PASS');
  const empty=planAdversarialCoverage([]); assert.equal(empty.status,'PASS'); assert.equal(empty.metrics.coveragePercent,0);
  assert.throws(()=>planAdversarialCoverage([{targetId:'',criticality:'normal',coveredTechniques:[],testRefs:[]}]),/target_invalid/);
  assert.throws(()=>planAdversarialCoverage([{targetId:'x',criticality:'normal',coveredTechniques:['boundary'],testRefs:['']}]),/coverage_invalid/);
  assert.throws(()=>planAdversarialCoverage([{targetId:'x',criticality:'normal',coveredTechniques:['boundary'],testRefs:['t']},{targetId:'x',criticality:'normal',coveredTechniques:['boundary'],testRefs:['t']}]),/target_invalid/);
});

test('trust and crash coverage matrices exercise expiry and state-direction failures',()=>{
  const expired=analyzeTrustBlastRadius([{grantId:'g',custodianId:'c',tenantIds:['t'],scopes:['s'],expiresAt:'2020-01-01T00:00:00Z',revocable:true}],['c'],'2026-01-01T00:00:00Z'); assert.equal(expired.metrics.grants,0);
  assert.throws(()=>analyzeTrustBlastRadius([{grantId:'',custodianId:'',tenantIds:[],scopes:[],expiresAt:'bad',revocable:true}],[],'2026-01-01T00:00:00Z'),/grant_invalid/);
  const crash=evaluateCrashConsistency([{scenarioId:'a',crashPoint:'before-private-write',recoveredState:'committed',duplicateSideEffect:false,testRef:'t'},{scenarioId:'b',crashPoint:'after-atomic-publish',recoveredState:'prior',duplicateSideEffect:false,testRef:'t'},{scenarioId:'c',crashPoint:'after-private-fsync',recoveredState:'prior',duplicateSideEffect:false,testRef:'t'},{scenarioId:'d',crashPoint:'after-ack',recoveredState:'committed',duplicateSideEffect:false,testRef:'t'}]);
  assert.ok(crash.findings.includes('prepublish_state_invalid:a')); assert.ok(crash.findings.includes('postpublish_state_invalid:b'));
});

test('claim, benchmark and portability edge branches remain fail closed',()=>{
  const claim=evaluateClaimEvidenceClosure([{claimId:'a',dependsOnClaimIds:['missing'],evidenceIds:[],limitationIds:[]}],[]); assert.equal(claim.status,'BLOCK'); assert.ok(claim.results[0]!.reasons.includes('dependent_claim_missing:missing'));
  assert.throws(()=>evaluateClaimEvidenceClosure([],[{evidenceId:'e',current:true,authentic:true,complete:true},{evidenceId:'e',current:true,authentic:true,complete:true}]),/evidence_identity_invalid/);
  const emptyLatency=evaluateProductPathBenchmarks([{pathId:'p',maximumP95Ms:1,minimumThroughputPerSecond:1,maximumHeapDeltaBytes:1,minimumSamples:1}],[{pathId:'p',latencyMs:[],throughputPerSecond:2,heapDeltaBytes:0,environment:'local-single-host'}]); assert.equal(emptyLatency.results[0]!.p95Ms,null);
  const noObserved=evaluatePortabilityMatrix([{targetId:'planned',operatingSystem:'windows',architecture:'x64',runtime:'node',build:'NOT_RUN',tests:'NOT_RUN',archiveSelfTest:'NOT_RUN',observed:false}]); assert.equal(noObserved.status,'BLOCK');
});

test('operator, recovery, qualification and verification identities reject duplicates',()=>{
  assert.throws(()=>evaluateOperatorTaskFlows([{flowId:'f',baselineSteps:2,criticalErrorOpportunities:0,steps:[{stepId:'x',action:'a',decisionRequired:false,irreversible:false,confirmation:false,recoveryAvailable:true,automated:false},{stepId:'x',action:'b',decisionRequired:false,irreversible:false,confirmation:false,recoveryAvailable:true,automated:false}]}]),/step_invalid/);
  assert.throws(()=>evaluateRecoveryGameDay([{scenarioId:'x',detected:true,contained:true,recovered:true,recertified:true,detectionMinutes:0,recoveryMinutes:0,rtoMinutes:1,evidenceRefs:['e']},{scenarioId:'x',detected:true,contained:true,recovered:true,recertified:true,detectionMinutes:0,recoveryMinutes:0,rtoMinutes:1,evidenceRefs:['e']}]),/scenario_invalid/);
  assert.throws(()=>buildQualificationExecutionPlan([{gateId:'x',prerequisiteGateIds:[],collectorId:'c',reviewerId:'r',commandRef:'c',evidencePath:'e',rollbackRef:'r',estimatedMinutes:1},{gateId:'x',prerequisiteGateIds:[],collectorId:'c',reviewerId:'r',commandRef:'c',evidencePath:'e',rollbackRef:'r',estimatedMinutes:1}]),/gate_invalid/);
  assert.throws(()=>buildChangeVerificationPlan({changedFiles:['x'],mappings:[],fullSuiteRef:''}),/full_suite_required/);
});
