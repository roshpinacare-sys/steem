import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, join } from 'node:path';
import { bindEvidenceArtifacts } from '../dist/src/validation/evidence-artifact-binding.js';
import { verifyDescriptionContracts } from '../dist/src/validation/description-contract-assurance.js';
import { evaluateEvidenceDependencyDag } from '../dist/src/validation/evidence-dependency-dag.js';
import { evaluateCapabilityUtilization } from '../dist/src/validation/capability-utilization-assurance.js';
import { evaluateClaimExecutionClosure } from '../dist/src/validation/claim-execution-assurance.js';
import { roastClaims } from '../dist/src/validation/adversarial-claim-roast.js';

const root=resolve('.');
const out=resolve(process.env.V32_6_RUN_DIR || (process.env.V32_6_RUN_ID?join('evidence/runs',process.env.V32_6_RUN_ID):'evidence/generated'));
mkdirSync(out,{recursive:true});
const identity=JSON.parse(execFileSync('python3',['scripts/test_ops_context_v32_6.py','--identity'],{cwd:root,encoding:'utf8'}));
const common={version:'32.9',generatedAt:new Date().toISOString(),...identity};
const required={
 full:'V32_6_FULL_TEST_RESULTS.json',coverage:'V32_COVERAGE_REPORT.json',quality:'V32_TEST_QUALITY_AUDIT.json',architecture:'V32_ARCHITECTURE_INTEGRITY.json',strategicMutation:'V32_8_STRATEGIC_MUTATION_RESULTS.json',claimMutation:'V32_9_CLAIM_EXECUTION_MUTATION_RESULTS.json'
};
for(const name of Object.values(required))if(!existsSync(join(out,name)))throw new Error(`v32_9_required_report_missing:${name}`);
const read=name=>JSON.parse(readFileSync(join(out,name),'utf8'));
const reports=Object.fromEntries(Object.entries(required).map(([k,n])=>[k,read(n)]));
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const rel=name=>relative(root,join(out,name)).replaceAll('\\','/');
const observedAt=new Date(Date.now()-1000).toISOString();
const producerMap={full:'full-test-runner',coverage:'coverage-runner',quality:'quality-auditor',architecture:'architecture-validator',strategicMutation:'strategic-mutation-runner',claimMutation:'claim-mutation-runner'};
const reviewerMap={full:'release-validator',coverage:'release-validator',quality:'release-validator',architecture:'release-validator',strategicMutation:'mutation-reviewer',claimMutation:'mutation-reviewer'};
const oracleMap={full:'node-test-tap',coverage:'v8-coverage',quality:'typescript-ast',architecture:'typescript-import-graph',strategicMutation:'marker-specific-mutation',claimMutation:'marker-specific-mutation'};
const environmentMap={full:'authoritative-local-process',coverage:'coverage-process',quality:'static-analysis-process',architecture:'architecture-analysis-process',strategicMutation:'isolated-mutation-sandbox',claimMutation:'isolated-mutation-sandbox'};
const artifactInputs=Object.entries(required).map(([key,name])=>({artifactId:key,claimId:'v32.9-local-proof-coherence',path:rel(name),declaredDigest:digest(join(out,name)),sourceDigest:identity.sourceDigest,artifactDigest:identity.compiledArtifactDigest,producerId:producerMap[key],reviewerId:reviewerMap[key],oracleId:oracleMap[key],environmentId:environmentMap[key],origin:'FILE',observed:true,accepted:true,current:true,createdAt:observedAt}));
const binding=bindEvidenceArtifacts(artifactInputs,{root,sourceDigest:identity.sourceDigest,artifactDigest:identity.compiledArtifactDigest,now:new Date().toISOString(),maximumAgeMs:60*60*1000});
write('V32_9_EVIDENCE_ARTIFACT_BINDING.json',{...common,...binding});

const localClaim={claimId:'v32.9-local-proof-coherence',kind:'LOCAL_RUNTIME',sourceDigest:identity.sourceDigest,artifactDigest:identity.compiledArtifactDigest,minimumEvidence:2,requireExternal:false,requireExecutable:true,requireNegativePath:true,requireCounterexampleSearch:true};
const localEvidence=[
 {evidenceId:'full-authoritative',claimId:localClaim.claimId,producerId:'full-test-runner',reviewerId:'release-validator',oracleId:'node-test-tap',environmentId:'authoritative-local-process',evidenceDigest:digest(join(out,required.full)),sourceDigest:identity.sourceDigest,artifactDigest:identity.compiledArtifactDigest,observed:true,executable:true,negativePath:true,counterexampleSearch:false,externallyCollected:false,current:true},
 {evidenceId:'strategic-mutation',claimId:localClaim.claimId,producerId:'strategic-mutation-runner',reviewerId:'mutation-reviewer',oracleId:'strategic-mutation',environmentId:'strategic-mutation-sandbox',evidenceDigest:digest(join(out,required.strategicMutation)),sourceDigest:identity.sourceDigest,artifactDigest:identity.compiledArtifactDigest,observed:true,executable:true,negativePath:true,counterexampleSearch:true,externallyCollected:false,current:true},
 {evidenceId:'claim-mutation',claimId:localClaim.claimId,producerId:'claim-mutation-runner',reviewerId:'mutation-reviewer',oracleId:'claim-execution-mutation',environmentId:'claim-mutation-sandbox',evidenceDigest:digest(join(out,required.claimMutation)),sourceDigest:identity.sourceDigest,artifactDigest:identity.compiledArtifactDigest,observed:true,executable:true,negativePath:true,counterexampleSearch:true,externallyCollected:false,current:true}
];
const challenged=[localClaim,
 {claimId:'production-qualified',kind:'EXTERNAL_QUALIFICATION',sourceDigest:identity.sourceDigest,artifactDigest:identity.compiledArtifactDigest,minimumEvidence:2,requireExternal:true,requireExecutable:true,requireNegativePath:true,requireCounterexampleSearch:true},
 {claimId:'human-value-proven',kind:'HUMAN_VALUE',sourceDigest:identity.sourceDigest,artifactDigest:identity.compiledArtifactDigest,minimumEvidence:2,requireExternal:true,requireExecutable:false,requireNegativePath:true,requireCounterexampleSearch:true},
 {claimId:'signed-provenance-proven',kind:'SUPPLY_CHAIN',sourceDigest:identity.sourceDigest,artifactDigest:identity.compiledArtifactDigest,minimumEvidence:2,requireExternal:true,requireExecutable:true,requireNegativePath:true,requireCounterexampleSearch:true}
];
const roastRaw=roastClaims(challenged,localEvidence);
const localResult=roastRaw.results.find(r=>r.claimId===localClaim.claimId);
const roast={...common,...roastRaw,rawStatus:roastRaw.status,status:localResult?.status==='SURVIVED'&&roastRaw.metrics.refuted===3?'PASS_WITH_EXPECTED_REFUTATIONS':'BLOCK',expectedRefutations:3,interpretation:'Unsupported external claims must be refuted; only digest-bound local execution may survive.'};
write('V32_9_ADVERSARIAL_CLAIM_ROAST.json',roast);

const description=verifyDescriptionContracts(root,[
 {claimId:'full-description',scope:'LOCAL',sourcePath:'docs/V32_9_CLAIM_TO_EXECUTION_CLOSURE.md',exactMarker:'CLAIM-V32.9-FULL:',evidencePath:rel(required.full),expectedStatus:'passed',evidenceOrigin:'LOCAL'},
 {claimId:'coverage-description',scope:'LOCAL',sourcePath:'docs/V32_9_CLAIM_TO_EXECUTION_CLOSURE.md',exactMarker:'CLAIM-V32.9-COVERAGE:',evidencePath:rel(required.coverage),expectedStatus:'passed',evidenceOrigin:'LOCAL'},
 {claimId:'architecture-description',scope:'LOCAL',sourcePath:'docs/V32_9_CLAIM_TO_EXECUTION_CLOSURE.md',exactMarker:'CLAIM-V32.9-ARCHITECTURE:',evidencePath:rel(required.architecture),expectedStatus:'PASS',evidenceOrigin:'LOCAL'},
 {claimId:'mutation-description',scope:'LOCAL',sourcePath:'docs/V32_9_CLAIM_TO_EXECUTION_CLOSURE.md',exactMarker:'CLAIM-V32.9-MUTATION:',evidencePath:rel(required.claimMutation),expectedStatus:'passed',evidenceOrigin:'LOCAL'},
 {claimId:'adapter-description',scope:'LOCAL',sourcePath:'docs/V32_9_CLAIM_TO_EXECUTION_CLOSURE.md',exactMarker:'CLAIM-V32.9-ADAPTERS:',evidencePath:rel(required.full),expectedStatus:'passed',evidenceOrigin:'LOCAL'},
 {claimId:'truth-description',scope:'LOCAL',sourcePath:'README.md',exactMarker:'CLAIM-V32.9-TRUTH:',evidencePath:rel('V32_9_ADVERSARIAL_CLAIM_ROAST.json'),expectedStatus:'PASS_WITH_EXPECTED_REFUTATIONS',evidenceOrigin:'LOCAL'}
]);
write('V32_9_DESCRIPTION_CONTRACTS.json',{...common,...description});

const stages=[
 {stageId:'clean-build',dependsOn:[],consumes:[],produces:['dist'],authoritative:true,external:false},
 {stageId:'full-test',dependsOn:['clean-build'],consumes:['dist'],produces:['full-report'],authoritative:true,external:false},
 {stageId:'coverage',dependsOn:['clean-build'],consumes:['dist'],produces:['coverage-report'],authoritative:true,external:false},
 {stageId:'quality',dependsOn:['clean-build'],consumes:['dist'],produces:['quality-report'],authoritative:true,external:false},
 {stageId:'architecture',dependsOn:['clean-build'],consumes:['dist'],produces:['architecture-report'],authoritative:true,external:false},
 {stageId:'strategic-mutation',dependsOn:['clean-build'],consumes:['dist'],produces:['strategic-mutation-report'],authoritative:true,external:false},
 {stageId:'claim-mutation',dependsOn:['clean-build'],consumes:['dist'],produces:['claim-mutation-report'],authoritative:true,external:false},
 {stageId:'artifact-binding',dependsOn:['full-test','coverage','quality','architecture','strategic-mutation','claim-mutation'],consumes:['full-report','coverage-report','quality-report','architecture-report','strategic-mutation-report','claim-mutation-report'],produces:['binding-report'],authoritative:true,external:false},
 {stageId:'claim-roast',dependsOn:['artifact-binding'],consumes:['binding-report'],produces:['roast-report'],authoritative:true,external:false},
 {stageId:'description-contracts',dependsOn:['artifact-binding','claim-roast'],consumes:['binding-report','roast-report'],produces:['description-report'],authoritative:true,external:false},
 {stageId:'capability-utilization',dependsOn:['full-test'],consumes:['full-report'],produces:['utilization-report'],authoritative:true,external:false},
 {stageId:'claim-closure',dependsOn:['description-contracts','capability-utilization','claim-roast'],consumes:['description-report','utilization-report','roast-report'],produces:['closure-report'],authoritative:true,external:false},
 {stageId:'final-validation',dependsOn:['claim-closure'],consumes:['closure-report'],produces:['final-report'],authoritative:true,external:false}
];
const dag=evaluateEvidenceDependencyDag(stages,'final-validation');
write('V32_9_EVIDENCE_DEPENDENCY_DAG.json',{...common,...dag});

const utilization=evaluateCapabilityUtilization(root,[
 {capabilityId:'evidence-artifact-binding',implementationPath:'src/validation/evidence-artifact-binding.ts',exportedSymbol:'bindEvidenceArtifacts',testPath:'tests/claim-execution-closure-v32_9.test.ts',boundedCallsitePath:'scripts/claim-execution-cycle-v32_9.mjs',evidencePath:rel(required.full)},
 {capabilityId:'description-contract-assurance',implementationPath:'src/validation/description-contract-assurance.ts',exportedSymbol:'verifyDescriptionContracts',testPath:'tests/claim-execution-closure-v32_9.test.ts',boundedCallsitePath:'scripts/claim-execution-cycle-v32_9.mjs',evidencePath:rel(required.full)},
 {capabilityId:'evidence-dependency-dag',implementationPath:'src/validation/evidence-dependency-dag.ts',exportedSymbol:'evaluateEvidenceDependencyDag',testPath:'tests/claim-execution-closure-v32_9.test.ts',boundedCallsitePath:'scripts/claim-execution-cycle-v32_9.mjs',evidencePath:rel(required.full)},
 {capabilityId:'capability-utilization-assurance',implementationPath:'src/validation/capability-utilization-assurance.ts',exportedSymbol:'evaluateCapabilityUtilization',testPath:'tests/claim-execution-closure-v32_9.test.ts',boundedCallsitePath:'scripts/claim-execution-cycle-v32_9.mjs',evidencePath:rel(required.full)},
 {capabilityId:'claim-execution-assurance',implementationPath:'src/validation/claim-execution-assurance.ts',exportedSymbol:'evaluateClaimExecutionClosure',testPath:'tests/claim-execution-closure-v32_9.test.ts',boundedCallsitePath:'scripts/claim-execution-cycle-v32_9.mjs',evidencePath:rel(required.full)},
 {capabilityId:'sarif-import',implementationPath:'src/validation/security-evidence-import.ts',exportedSymbol:'evaluateSarifSecurityEvidence',testPath:'tests/external-assurance-import-cli-v32_9.test.ts',boundedCallsitePath:'scripts/import-external-assurance-evidence-v32_9.mjs',evidencePath:rel(required.full)},
 {capabilityId:'attestation-import',implementationPath:'src/validation/security-evidence-import.ts',exportedSymbol:'evaluateAttestationEvidence',testPath:'tests/external-assurance-import-cli-v32_9.test.ts',boundedCallsitePath:'scripts/import-external-assurance-evidence-v32_9.mjs',evidencePath:rel(required.full)},
 {capabilityId:'policy-import',implementationPath:'src/validation/policy-formal-fuzz-assurance.ts',exportedSymbol:'evaluatePolicyEvidence',testPath:'tests/external-assurance-import-cli-v32_9.test.ts',boundedCallsitePath:'scripts/import-external-assurance-evidence-v32_9.mjs',evidencePath:rel(required.full)},
 {capabilityId:'formal-import',implementationPath:'src/validation/policy-formal-fuzz-assurance.ts',exportedSymbol:'evaluateFormalModelEvidence',testPath:'tests/external-assurance-import-cli-v32_9.test.ts',boundedCallsitePath:'scripts/import-external-assurance-evidence-v32_9.mjs',evidencePath:rel(required.full)},
 {capabilityId:'fuzz-import',implementationPath:'src/validation/policy-formal-fuzz-assurance.ts',exportedSymbol:'evaluateFuzzEvidence',testPath:'tests/external-assurance-import-cli-v32_9.test.ts',boundedCallsitePath:'scripts/import-external-assurance-evidence-v32_9.mjs',evidencePath:rel(required.full)}
]);
write('V32_9_CAPABILITY_UTILIZATION.json',{...common,...utilization});

const closure=evaluateClaimExecutionClosure({gates:[{gateId:'artifact-binding',status:binding.status,reportDigest:binding.reportDigest},{gateId:'description-contracts',status:description.status,reportDigest:description.reportDigest},{gateId:'evidence-dag',status:dag.status,reportDigest:dag.reportDigest},{gateId:'capability-utilization',status:utilization.status,reportDigest:utilization.reportDigest}],survivedLocalClaims:localResult?.status==='SURVIVED'?1:0,expectedRefutations:3,actualRefutations:roastRaw.metrics.refuted,externalToolsExecuted:0,externalBlockers:['postgres-ha-pitr-unqualified','hsm-kms-unqualified','human-pilot-not-executed','signed-provenance-not-executed','external-tools-not-executed']});
write('V32_9_CLAIM_EXECUTION_CLOSURE.json',{...common,...closure});
const summary={...common,status:closure.status,disposition:closure.disposition,productionPromotion:closure.productionPromotion,artifacts:binding.metrics,descriptions:description.metrics,dag:dag.metrics,utilization:utilization.metrics,claims:{survived:roastRaw.metrics.survived,refuted:roastRaw.metrics.refuted},externalToolRuns:0,reportDigest:closure.reportDigest};
write('V32_9_CLAIM_EXECUTION_SUMMARY.json',summary);
console.log(JSON.stringify(summary,null,2));
if(closure.status!=='PASS')process.exit(1);
function write(name,value){writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');}
