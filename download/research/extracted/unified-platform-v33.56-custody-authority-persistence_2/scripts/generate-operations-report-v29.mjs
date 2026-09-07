import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildOperatorActionCenter } from '../dist/src/operations/operator-action-center.js';
import { OperationalActionLedger } from '../dist/src/operations/action-ledger.js';
const tests=JSON.parse(readFileSync('evidence/generated/V29_TEST_RESULTS.json','utf8'));
const value=JSON.parse(readFileSync('evidence/generated/V29_VALUE_AUTOMATION_PROOF.json','utf8'));
const center=buildOperatorActionCenter({
 dependencies:[
  {id:'governed-automation-local-proof',state:'ready',detail:`${value.proofScope.scenarios} scenarios and ${value.results.totalActionsProposed} proposals verified with zero external effects.`,owner:'Automation Operations Lead'},
  {id:'postgresql-primary-standby',state:'blocked',detail:'No live primary/standby qualification evidence.',owner:'Durable Runtime Lead'},
  {id:'kms-hsm',state:'blocked',detail:'No authorized KMS/HSM is connected.',owner:'Key Custody Lead'},
  {id:'untrusted-isolation',state:'blocked',detail:'Single-host research containment is not independently qualified.',owner:'Isolation Reviewer'},
  {id:'human-pilot',state:'unknown',detail:'Six-task protocol exists but no participant results exist.',owner:'Product Research Lead'},
 ],
 risks:[{id:'modeled-value-overclaim',severity:'high',summary:'Do not convert modeled workflow reduction into a human-value claim',affectedArea:'product value',mitigation:'Keep status promising until consented comparative pilot evidence exists.'},{id:'external-effects',severity:'critical',summary:'Automation must remain proposal-only',affectedArea:'execution authority',mitigation:'Dual review, mutation gate and zero-effect assertion remain release blockers.'}],
 failedTests:tests.totals.failed,orphanProcesses:0,testRuntimeRegression:false,
});
const ledger=new OperationalActionLedger(center.actions,'2026-07-17T18:40:00.000Z'); const snapshot=ledger.snapshot(new Date('2026-07-18T18:40:00.000Z'),24*60*60*1000);
const report={version:'29.0',status:center.overallState==='blocked'&&ledger.verify()?'passed':'failed',center,lifecycle:{eventRoot:snapshot.rootDigest,statusCounts:snapshot.statusCounts,overdueActionIds:snapshot.overdueActionIds,verified:ledger.verify()},automation:{scenarios:value.proofScope.scenarios,actionsProposed:value.results.totalActionsProposed,externalEffectsExecuted:value.results.externalEffectsExecuted,restartReplayModelCalls:value.results.restartReplayModelCalls},classification:'operator decision support and governed automation proposals, not production authority',limitations:['External qualification and measured human value remain blocked.']};
mkdirSync('evidence/generated',{recursive:true});writeFileSync('evidence/generated/V29_OPERATIONAL_ACTION_CENTER.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,overallState:center.overallState,actions:center.actions.length,automation:report.automation},null,2));if(report.status!=='passed')process.exit(1);
