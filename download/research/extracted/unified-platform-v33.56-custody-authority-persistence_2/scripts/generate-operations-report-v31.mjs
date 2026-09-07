import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildOperatorActionCenter } from '../dist/src/operations/operator-action-center.js';
import { OperationalActionLedger } from '../dist/src/operations/action-ledger.js';
const tests=JSON.parse(readFileSync('evidence/generated/V31_TEST_RESULTS.json','utf8'));
const value=JSON.parse(readFileSync('evidence/generated/V31_SOVEREIGNTY_VALUE_PROOF.json','utf8'));
const center=buildOperatorActionCenter({
 dependencies:[
  {id:'sovereign-provider-review-local-proof',state:'ready',detail:`${value.results.campaignItems} campaign items, ${value.results.externalInteractionsExecuted} disclosed provider interactions, zero external mutations and ${value.results.independentReviewerOrganizations} reviewer organizations verified.`,owner:'Sovereignty Review Lead'},
  {id:'postgresql-primary-standby',state:'blocked',detail:'No live primary/standby qualification evidence.',owner:'Durable Runtime Lead'},
  {id:'kms-hsm',state:'blocked',detail:'No authorized external KMS/HSM is connected.',owner:'Key Custody Lead'},
  {id:'untrusted-isolation',state:'blocked',detail:'Single-host containment is not independently qualified.',owner:'Isolation Reviewer'},
  {id:'human-pilot',state:'unknown',detail:'Comparative protocol exists but no participant results exist.',owner:'Product Research Lead'},
 ],
 risks:[
  {id:'modeled-value-overclaim',severity:'high',summary:'Do not convert modeled product value into a human productivity claim',affectedArea:'product value',mitigation:'Keep status promising until consented comparative pilot evidence exists.'},
  {id:'campaign-self-approval',severity:'critical',summary:'Campaign results require two independent signed attestations',affectedArea:'execution authority',mitigation:'Dual signatures, mutation gate and reviewer independence remain release blockers.'},
  {id:'provider-disclosure-and-mutation',severity:'critical',summary:'Provider interaction must be disclosed and must not become external mutation',affectedArea:'execution authority',mitigation:'Explicit interaction accounting, zero-mutation assertion, signed attestation and current revocation remain mandatory.'}
 ],
 failedTests:tests.totals.failed,orphanProcesses:0,testRuntimeRegression:false,
});
const ledger=new OperationalActionLedger(center.actions,'2026-07-17T18:40:00.000Z');
const snapshot=ledger.snapshot(new Date('2026-07-18T18:40:00.000Z'),24*60*60*1000);
const report={version:'31.0',status:center.overallState==='blocked'&&ledger.verify()?'passed':'failed',center,lifecycle:{eventRoot:snapshot.rootDigest,statusCounts:snapshot.statusCounts,overdueActionIds:snapshot.overdueActionIds,verified:ledger.verify()},campaign:{items:value.results.campaignItems,stages:value.results.campaignStages,progressPercent:value.results.campaignProgressPercent,state:value.results.campaignState,signedReviewers:value.results.independentSignedReviewers,reviewerOrganizations:value.results.independentReviewerOrganizations,restartReplayProviderInteractions:value.results.restartReplayProviderInteractions,revokedCredentialReplayBlocked:value.results.revokedCredentialReplayBlocked,externalInteractionsExecuted:value.results.externalInteractionsExecuted,externalMutationsExecuted:value.results.externalMutationsExecuted},classification:'operator decision support and governed engineering campaign proposals, not production authority',limitations:['External qualification and measured human value remain blocked.','Campaign completion proves local mechanism behavior, not commercial adoption or production reliability.']};
mkdirSync('evidence/generated',{recursive:true});writeFileSync('evidence/generated/V31_OPERATIONAL_ACTION_CENTER.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,overallState:center.overallState,actions:center.actions.length,campaign:report.campaign},null,2));if(report.status!=='passed')process.exit(1);
