import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
function load(name, fallback={status:'missing'}){const p=`evidence/generated/${name}`;return existsSync(p)?JSON.parse(readFileSync(p,'utf8')):fallback;}
const tests=load('V29_TEST_RESULTS.json'), coverage=load('V29_COVERAGE_REPORT.json'), quality=load('V29_TEST_QUALITY_AUDIT.json'), architecture=load('V29_ARCHITECTURE_INTEGRITY.json'), mutation=load('V29_AUTOMATION_MUTATION_RESULTS.json'), value=load('V29_VALUE_AUTOMATION_PROOF.json'), integration=load('V29_INTEGRATION_CLOSURE.json'), supply=load('V29_SUPPLY_CHAIN_REPORT.json'), incomplete=load('V29_INCOMPLETE_CODE_AUDIT.json'), dr=load('V29_LOCAL_DR_REHEARSAL.json'), browser=load('V29_BROWSER_E2E.json'), isolation=load('V29_LINUX_ISOLATION.json'), postgres=load('V29_POSTGRES_QUALIFICATION.json'), pilot=load('V29_HUMAN_PILOT_PROTOCOL.json'), stability=load('V29_STABILITY_REPORT.json');
const local=[
 {gate:'Full test suite',pass:tests.status==='passed'&&tests.totals.failed===0&&tests.totals.tests===tests.totals.passed,evidence:'V29_TEST_RESULTS.json'},
 {gate:'Coverage floor',pass:coverage.status==='passed'&&coverage.current.linePercent>=99&&coverage.current.branchPercent>=96&&coverage.current.functionPercent>=98.5,evidence:'V29_COVERAGE_REPORT.json'},
 {gate:'Test quality',pass:quality.status==='passed'&&quality.criticalOrHighIssues===0&&quality.mediumIssues===0,evidence:'V29_TEST_QUALITY_AUDIT.json'},
 {gate:'Architecture closure',pass:architecture.status==='PASS'&&architecture.metrics.sourceCycleCount===0&&architecture.metrics.untestedSourceCount===0&&architecture.metrics.closedCapabilityPathCount===architecture.metrics.capabilityPathCount,evidence:'V29_ARCHITECTURE_INTEGRITY.json'},
 {gate:'Automation mutation authenticity',pass:mutation.status==='passed'&&mutation.survivors===0&&mutation.invalidKills===0&&mutation.mutantsKilledAuthentically===mutation.mutantsSpecified,evidence:'V29_AUTOMATION_MUTATION_RESULTS.json'},
 {gate:'Value automation proof',pass:value.status==='passed'&&value.results.externalEffectsExecuted===0&&value.results.restartReplayModelCalls===0,evidence:'V29_VALUE_AUTOMATION_PROOF.json'},
 {gate:'Integration closure',pass:integration.status==='passed'&&integration.edgesClosed===integration.edgesSpecified,evidence:'V29_INTEGRATION_CLOSURE.json'},
 {gate:'Supply chain',pass:['passed','passed-with-advisory-environment-blocked'].includes(supply.status),evidence:'V29_SUPPLY_CHAIN_REPORT.json'},
 {gate:'Incomplete-code audit',pass:incomplete.status==='passed',evidence:'V29_INCOMPLETE_CODE_AUDIT.json'},
 {gate:'Local DR',pass:dr.status==='passed-local-rehearsal',evidence:'V29_LOCAL_DR_REHEARSAL.json'},
 {gate:'Browser workflow',pass:browser.status==='passed',evidence:'V29_BROWSER_E2E.json'},
 {gate:'Single-host isolation proof',pass:isolation.status==='passed-single-host-research-proof',evidence:'V29_LINUX_ISOLATION.json'},
 {gate:'Three-run stability',pass:stability.status==='passed'&&stability.flakeCount===0,evidence:'V29_STABILITY_REPORT.json'},
];
const localFailures=local.filter((x)=>!x.pass);
const external=[
 {gate:'PostgreSQL durable runtime',status:postgres.status??'missing',qualified:postgres.status==='implemented-and-exercised-single-database',evidence:'V29_POSTGRES_QUALIFICATION.json',blocker:postgres.blocker},
 {gate:'Measured human pilot',status:pilot.status??'missing',qualified:false,evidence:'V29_HUMAN_PILOT_PROTOCOL.json'},
 {gate:'Real KMS/HSM',status:'environment-blocked',qualified:false,evidence:'none'},
 {gate:'Independent isolation assessment',status:'not-qualified',qualified:false,evidence:'V29_LINUX_ISOLATION.json'},
 {gate:'External penetration and licensing',status:'not-executed',qualified:false,evidence:'none'},
 {gate:'Multi-host SLO and DR',status:'not-executed',qualified:false,evidence:'none'},
];
const report={version:'29.0',status:localFailures.length===0?'passed-integrated-pilot':'failed',readiness:localFailures.length===0?'Integrated Pilot':'Development',productionPromotion:'blocked',localGates:local,externalGates:external,counts:{localPassed:local.length-localFailures.length,localTotal:local.length,externalQualified:external.filter((x)=>x.qualified).length,externalTotal:external.length},hardFailures:localFailures.map((x)=>x.gate),limitations:['Local proof does not qualify production infrastructure or human value.','Modeled workflow reductions remain hypotheses until the consented pilot is executed.']};
mkdirSync('evidence/generated',{recursive:true});writeFileSync('evidence/generated/V29_QUALIFICATION_MATRIX.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,readiness:report.readiness,productionPromotion:report.productionPromotion,counts:report.counts,hardFailures:report.hardFailures},null,2));if(localFailures.length)process.exit(1);
