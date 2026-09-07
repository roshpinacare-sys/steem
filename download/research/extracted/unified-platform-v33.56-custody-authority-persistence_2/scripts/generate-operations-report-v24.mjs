import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildOperatorActionCenter } from '../dist/src/operations/operator-action-center.js';
const load = (name) => { const path=resolve('evidence/generated',name); return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null; };
const tests=load('V24_TEST_RESULTS.json'); const perf=load('V24_LOCAL_PERFORMANCE.json'); const postgres=load('V24_POSTGRES_QUALIFICATION.json'); const isolation=load('V24_LINUX_ISOLATION.json');
const center=buildOperatorActionCenter({
  failedTests: tests?.totals?.failed ?? 1,
  orphanProcesses: 0,
  testRuntimeRegression: perf?.fullSuite?.comparison?.status === 'regressed',
  dependencies:[
    {id:'local-sqlite-runtime',state:tests?.status==='passed'?'ready':'degraded',detail:tests?.status==='passed'?'Durability and recovery tests passed locally.':'Local runtime tests are incomplete or failing.',owner:'Runtime Operations Lead'},
    {id:'postgres-primary-standby',state:postgres?.status==='implemented-and-exercised-single-database'?'unknown':'blocked',detail:postgres?.status==='implemented-and-exercised-single-database'?'Single-database qualification passed; failover remains unmeasured.':'No live PostgreSQL primary/standby qualification.',owner:'Database Qualification Lead',runbook:'docs/V24_EXTERNAL_QUALIFICATION_RUNBOOK.md'},
    {id:'kms-hsm',state:'blocked',detail:'No authorized KMS/HSM endpoint, key policy, or custody audit was supplied.',owner:'Key Custody Lead',runbook:'docs/V24_EXTERNAL_QUALIFICATION_RUNBOOK.md'},
    {id:'untrusted-code-isolation',state:isolation?.status==='passed-single-host-research-proof'?'unknown':'blocked',detail:isolation?.status==='passed-single-host-research-proof'?'Single-host research proof passed; independent target-boundary review remains.':'Isolation research proof is absent or failing.',owner:'Capability Isolation Lead',runbook:'docs/V24_EXTERNAL_QUALIFICATION_RUNBOOK.md'},
    {id:'human-pilot',state:'blocked',detail:'Protocol exists but no consented participant evidence was collected.',owner:'Product Research Lead',runbook:'docs/V24_HUMAN_PILOT_RUNBOOK.md'},
  ],
  risks:[
    {id:'R24-TEST-HOST-CONTENTION',severity:'medium',summary:'Track full-suite runtime variance before tightening budgets',affectedArea:'developer and release feedback time',mitigation:'Three-run stability report and conservative performance comparison.'},
    {id:'R24-EXTERNAL-EVIDENCE',severity:'high',summary:'Do not promote local proof as production qualification',affectedArea:'runtime, security, and human-use claims',mitigation:'Production promotion remains blocked by explicit qualification matrix.'},
  ],
});
const report={version:'24.0',ownerRole:'Product Operations and Runtime Operations Leads',status:center.overallState==='blocked'&&center.blockedDependencies.includes('postgres-primary-standby')&&center.blockedDependencies.includes('kms-hsm')?'passed':'failed',generatedAt:new Date().toISOString(),center,decisionContract:{firstViewShowsStopActions:true,blockedDependenciesNamed:true,completionEvidenceRequired:true,localReadyDoesNotMeanProductionReady:true},limitations:['Generated from current evidence snapshots; operators must refresh it after incidents, dependency changes, or qualification runs.']};
const output=resolve('evidence/generated/V24_OPERATIONAL_ACTION_CENTER.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,overallState:center.overallState,actions:center.actions.length,blockedDependencies:center.blockedDependencies},null,2));if(report.status!=='passed')process.exit(1);
