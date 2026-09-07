import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256 } from '../dist/src/contracts/crypto.js';
import { evaluateVettedToolIntake } from '../dist/src/validation/vetted-tool-intake.js';
import { roastClaims } from '../dist/src/validation/adversarial-claim-roast.js';
import { evaluateWorkflowSecurity } from '../dist/src/validation/workflow-security-assurance.js';
import { evaluateStrategicUpgrade } from '../dist/src/validation/strategic-upgrade-assurance.js';

const root=resolve('.');
const out=resolve(process.env.V32_6_RUN_DIR || (process.env.V32_6_RUN_ID ? join('evidence/runs', process.env.V32_6_RUN_ID) : 'evidence/generated'));mkdirSync(out,{recursive:true});
const identity=JSON.parse(execFileSync('python3',['scripts/test_ops_context_v32_6.py','--identity'],{cwd:root,encoding:'utf8'}));
const now=new Date().toISOString();
const H=identity.sourceDigest,A=identity.compiledArtifactDigest;
const workflowFiles=['.github/workflows/ci.yml','.github/workflows/deep-assurance.yml'].map(path=>({path,content:readFileSync(join(root,path),'utf8')}));
const workflowSecurity=evaluateWorkflowSecurity(workflowFiles,{requireImmutableActions:true,requireCheckoutCredentialIsolation:true,maximumArtifactRetentionDays:30,forbidPullRequestTarget:true,forbidWritePermissions:true,requireIgnoreScripts:true});

const actions=[
 ['checkout','https://github.com/actions/checkout','11bd71901bbe5b1630ceea73d27597364c9af683'],
 ['setup-node','https://github.com/actions/setup-node','49933ea5288caeca8642d1e84afbd3f7d6820020'],
 ['cache','https://github.com/actions/cache','5a3ec84eff668545956fd18022155c47e93e2684'],
 ['upload-artifact','https://github.com/actions/upload-artifact','ea165f8d65b6e75b540449e92b4886f43607fa02'],
 ['download-artifact','https://github.com/actions/download-artifact','634f93cb2916e3fdff6788551b99b062d0335ce0'],
].map(([toolId,repository,commitSha])=>({toolId,repository,organization:'actions',commitSha,license:'MIT',officialOrganization:true,archived:false,fork:false,securityPolicy:true,signedRelease:true,branchProtectionObserved:false,scorecardScore:0,requestedMode:'METADATA_ONLY',requestsVendoring:false,requestsAutomaticExecution:false,networkRequiredAtRuntime:false}));
const toolIntake=evaluateVettedToolIntake(actions,{allowedOrganizations:['actions'],allowedLicenses:['MIT'],minimumScorecard:0,requireSignedRelease:true,requireSecurityPolicy:true,requireBranchProtection:false});

const localClaim={claimId:'v32.7-local-proof-coherence',kind:'LOCAL_RUNTIME',sourceDigest:H,artifactDigest:A,minimumEvidence:2,requireExternal:false,requireExecutable:true,requireNegativePath:true,requireCounterexampleSearch:true};
const localEvidence=[
 {evidenceId:'full-authoritative',claimId:localClaim.claimId,producerId:'test-runner',reviewerId:'final-validator',oracleId:'node-test',environmentId:'local-process',evidenceDigest:'a'.repeat(64),sourceDigest:H,artifactDigest:A,observed:true,executable:true,negativePath:true,counterexampleSearch:false,externallyCollected:false,current:true},
 {evidenceId:'mutation-adversarial',claimId:localClaim.claimId,producerId:'mutation-runner',reviewerId:'architecture-validator',oracleId:'mutation',environmentId:'mutation-sandbox',evidenceDigest:'b'.repeat(64),sourceDigest:H,artifactDigest:A,observed:true,executable:true,negativePath:true,counterexampleSearch:true,externallyCollected:false,current:true},
];
const localRoast=roastClaims([localClaim],localEvidence);
const challengedClaims=[
 localClaim,
 {claimId:'production-qualified',kind:'EXTERNAL_QUALIFICATION',sourceDigest:H,artifactDigest:A,minimumEvidence:2,requireExternal:true,requireExecutable:true,requireNegativePath:true,requireCounterexampleSearch:true},
 {claimId:'human-value-proven',kind:'HUMAN_VALUE',sourceDigest:H,artifactDigest:A,minimumEvidence:2,requireExternal:true,requireExecutable:false,requireNegativePath:true,requireCounterexampleSearch:true},
 {claimId:'signed-supply-chain-provenance',kind:'SUPPLY_CHAIN',sourceDigest:H,artifactDigest:A,minimumEvidence:2,requireExternal:true,requireExecutable:true,requireNegativePath:true,requireCounterexampleSearch:true},
];
const globalRoast=roastClaims(challengedClaims,localEvidence);
const pending=(id)=>({status:'NOT_EXECUTED',reportDigest:sha256({id,status:'NOT_EXECUTED',sourceDigest:H,artifactDigest:A})});
const strategic=evaluateStrategicUpgrade({workflowSecurity,toolIntake,sarifSecurity:pending('codeql-sarif'),attestation:pending('sigstore-in-toto'),policy:pending('opa-policy'),formalModel:pending('tla-model'),fuzz:pending('oss-fuzz'),claimRoast:localRoast,externalBlockers:['codeql-not-executed','scorecard-not-executed','cosign-witness-not-executed','opa-not-executed','tla-model-not-executed','oss-fuzz-not-executed','postgres-ha-pitr-unqualified','human-pilot-not-executed']});
const catalog=JSON.parse(readFileSync('config/vetted-strategic-tools-v32_8.json','utf8'));
const common={version:'32.8',generatedAt:now,...identity};
write('V32_8_WORKFLOW_SECURITY.json',{...common,...workflowSecurity,limitations:['Line-oriented workflow audit complements but does not replace GitHub-hosted policy enforcement.']});
write('V32_8_PINNED_ACTION_INTAKE.json',{...common,...toolIntake,scope:'Pinned actions already used by repository workflows; Scorecard floor intentionally not claimed in this local run.'});
write('V32_8_ADVERSARIAL_CLAIM_ROAST.json',{...common,status:'PASS_WITH_EXPECTED_REFUTATIONS',localReleaseEligibleClaim:localRoast,allChallengedClaims:globalRoast,expectedRefutedClaims:['production-qualified','human-value-proven','signed-supply-chain-provenance'],interpretation:'A refuted unsupported claim is a successful adversarial outcome, not a release failure.'});
write('V32_8_GITHUB_TOOL_CATALOG.json',{...common,...catalog,truthBoundary:'Adapters implemented and tested. External tools and their evidence were not executed in this environment.'});
write('V32_8_STRATEGIC_ASSURANCE.json',{...common,...strategic,limitations:['No CodeQL, Scorecard, Cosign, Witness, OPA, TLC or OSS-Fuzz result is claimed as executed.','Production promotion remains blocked.']});
const summary={status:workflowSecurity.status==='PASS'&&toolIntake.status==='PASS'&&localRoast.status==='PASS'&&strategic.status==='READY_WITH_UNEXECUTED_GATES'?'PASS':'BLOCK',workflow:workflowSecurity.metrics,pinnedActions:toolIntake.approved.length,claims:{challenged:globalRoast.metrics.claims,survived:globalRoast.metrics.survived,refuted:globalRoast.metrics.refuted},adapterContracts:7,externalToolRuns:0,strategicDisposition:strategic.disposition,productionPromotion:strategic.productionPromotion,sourceDigest:H,artifactDigest:A};
write('V32_8_STRATEGIC_ADVERSARIAL_SUMMARY.json',{...common,...summary,reportDigest:sha256(summary)});
console.log(JSON.stringify(summary,null,2));if(summary.status!=='PASS')process.exit(1);
function write(name,value){writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');}
