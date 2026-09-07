import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
function load(name,fallback={status:'missing'}){const p=`evidence/generated/${name}`;return existsSync(p)?JSON.parse(readFileSync(p,'utf8')):fallback;}
const tests=load('V30_TEST_RESULTS.json'),coverage=load('V30_COVERAGE_REPORT.json'),quality=load('V30_TEST_QUALITY_AUDIT.json'),architecture=load('V30_ARCHITECTURE_INTEGRITY.json'),mutation=load('V30_CAMPAIGN_MUTATION_RESULTS.json'),value=load('V30_CAMPAIGN_VALUE_PROOF.json'),integration=load('V30_INTEGRATION_CLOSURE.json'),supply=load('V30_SUPPLY_CHAIN_REPORT.json'),incomplete=load('V30_INCOMPLETE_CODE_AUDIT.json'),dr=load('V30_LOCAL_DR_REHEARSAL.json'),browser=load('V30_BROWSER_E2E.json'),isolation=load('V30_LINUX_ISOLATION.json'),postgres=load('V30_POSTGRES_QUALIFICATION.json'),pilot=load('V30_HUMAN_PILOT_PROTOCOL.json'),stability=load('V30_STABILITY_REPORT.json'),operations=load('V30_OPERATIONAL_ACTION_CENTER.json');
const local=[
 {gate:'Full test suite',pass:tests.status==='passed'&&tests.totals.failed===0&&tests.totals.tests===tests.totals.passed&&tests.totals.tests>=508,evidence:'V30_TEST_RESULTS.json'},
 {gate:'Coverage floor',pass:coverage.status==='passed'&&coverage.current.linePercent>=99&&coverage.current.branchPercent>=96&&coverage.current.functionPercent>=98.5,evidence:'V30_COVERAGE_REPORT.json'},
 {gate:'Test quality',pass:quality.status==='passed'&&quality.criticalOrHighIssues===0&&quality.mediumIssues===0,evidence:'V30_TEST_QUALITY_AUDIT.json'},
 {gate:'Architecture closure',pass:architecture.status==='PASS'&&architecture.metrics.sourceCycleCount===0&&architecture.metrics.untestedSourceCount===0&&architecture.metrics.closedCapabilityPathCount===architecture.metrics.capabilityPathCount,evidence:'V30_ARCHITECTURE_INTEGRITY.json'},
 {gate:'Campaign mutation authenticity',pass:mutation.status==='passed'&&mutation.survivors===0&&mutation.invalidKills===0&&mutation.mutantsKilledAuthentically===mutation.mutantsSpecified,evidence:'V30_CAMPAIGN_MUTATION_RESULTS.json'},
 {gate:'Campaign value proof',pass:value.status==='passed'&&value.results.externalEffectsExecuted===0&&value.results.restartReplayModelCalls===0&&value.results.campaignState==='COMPLETED'&&value.valueEvidence.claimedStatus==='PROMISING_NOT_HUMAN_VALIDATED',evidence:'V30_CAMPAIGN_VALUE_PROOF.json'},
 {gate:'Integration closure',pass:integration.status==='passed'&&integration.summary.closed===integration.summary.edges&&integration.summary.externalEffectsExecuted===0,evidence:'V30_INTEGRATION_CLOSURE.json'},
 {gate:'Supply chain',pass:['passed','passed-with-advisory-environment-blocked'].includes(supply.status),evidence:'V30_SUPPLY_CHAIN_REPORT.json'},
 {gate:'Incomplete-code audit',pass:incomplete.status==='passed',evidence:'V30_INCOMPLETE_CODE_AUDIT.json'},
 {gate:'Local DR',pass:dr.status==='passed-local-rehearsal',evidence:'V30_LOCAL_DR_REHEARSAL.json'},
 {gate:'Browser workflow',pass:browser.status==='passed',evidence:'V30_BROWSER_E2E.json'},
 {gate:'Single-host isolation proof',pass:isolation.status==='passed-single-host-research-proof',evidence:'V30_LINUX_ISOLATION.json'},
 {gate:'Three-run stability',pass:stability.status==='passed'&&stability.flakeCount===0,evidence:'V30_STABILITY_REPORT.json'},
 {gate:'Operational fail-closed state',pass:operations.status==='passed'&&operations.campaign.externalEffectsExecuted===0,evidence:'V30_OPERATIONAL_ACTION_CENTER.json'}
];
const external=[
 {gate:'PostgreSQL durable runtime',status:postgres.status??'missing',qualified:postgres.status==='implemented-and-exercised-single-database',evidence:'V30_POSTGRES_QUALIFICATION.json',blocker:postgres.blocker},
 {gate:'Measured human pilot',status:pilot.status??'missing',qualified:false,evidence:'V30_HUMAN_PILOT_PROTOCOL.json'},
 {gate:'External model-provider qualification',status:'not-qualified',qualified:false,evidence:'V30_CAMPAIGN_VALUE_PROOF.json'},
 {gate:'Real KMS/HSM',status:'environment-blocked',qualified:false,evidence:'none'},
 {gate:'Independent isolation assessment',status:'not-qualified',qualified:false,evidence:'V30_LINUX_ISOLATION.json'},
 {gate:'External penetration and licensing',status:'not-executed',qualified:false,evidence:'none'},
 {gate:'Multi-host SLO and DR',status:'not-executed',qualified:false,evidence:'none'}
];
const localFailures=local.filter(x=>!x.pass);const report={version:'30.0',status:localFailures.length===0?'passed-integrated-pilot':'failed',readiness:localFailures.length===0?'Integrated Pilot':'Development',productionPromotion:'blocked',localGates:local,externalGates:external,counts:{localPassed:local.length-localFailures.length,localTotal:local.length,externalQualified:external.filter(x=>x.qualified).length,externalTotal:external.length},hardFailures:localFailures.map(x=>x.gate),limitations:['Local proof does not qualify production infrastructure, external model services or human value.','Modeled product value remains a hypothesis until the consented pilot is executed.']};mkdirSync('evidence/generated',{recursive:true});writeFileSync('evidence/generated/V30_QUALIFICATION_MATRIX.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,readiness:report.readiness,productionPromotion:report.productionPromotion,counts:report.counts,hardFailures:report.hardFailures},null,2));if(localFailures.length)process.exit(1);
