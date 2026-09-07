import assert from 'node:assert/strict';
import test from 'node:test';
import { compileFailureKnowledge, type FailureCategory, type FailureObservation } from '../src/platform/failure-knowledge.js';
import { buildOperatorActionCenter } from '../src/operations/operator-action-center.js';
const categories:FailureCategory[]=['DUPLICATE_EFFECT','STALE_WORKER','UNVERIFIED_WEBHOOK','IMPORT_SIDE_EFFECT','FALSE_HEALTH','FALSE_CLAIM','LEDGER_IMBALANCE','SELF_APPROVAL','TENANT_LEAK','UNKNOWN'];
function failure(category:FailureCategory,patch:Partial<FailureObservation>={}):FailureObservation{return{failureId:`failure-${category}`,tenantId:'tenant-1',category,sourceSystem:'v27',subject:'subject',evidenceRefs:['evidence'],observedAt:'2026-07-17T00:00:00Z',severity:'HIGH',...patch};}

test('every failure category compiles deterministically with honest automation boundaries',()=>{
  for(const category of categories){const first=compileFailureKnowledge(failure(category));const second=compileFailureKnowledge(failure(category));assert.equal(first.digest,second.digest);assert.equal(first.automatic,category!=='UNKNOWN');assert.ok(first.invariant.length>10);assert.ok(first.regressionTest.length>10);}
});

test('failure compiler rejects every missing identity, timestamp and evidence field',()=>{
  for(const patch of [{failureId:''},{tenantId:''},{sourceSystem:''},{subject:''},{observedAt:'bad'},{evidenceRefs:[]}])assert.throws(()=>compileFailureKnowledge(failure('FALSE_CLAIM',patch)));
});

test('operator action center exercises stop, repair, verify, optimize and monitor actions with all severity branches',()=>{
  const report=buildOperatorActionCenter({failedTests:2,orphanProcesses:1,testRuntimeRegression:true,dependencies:[
    {id:'postgres',state:'blocked',detail:'not qualified',owner:'db',runbook:'db.md'},
    {id:'kms',state:'degraded',detail:'fallback',owner:'security'},
    {id:'sandbox',state:'unknown',detail:'unmeasured',owner:'runtime',runbook:'sandbox.md'},
    {id:'local',state:'ready',detail:'ok',owner:'ops'},
  ],risks:[
    {id:'critical',severity:'critical',summary:'critical risk',affectedArea:'authority',mitigation:'blocked'},
    {id:'high',severity:'high',summary:'high risk',affectedArea:'tenant'},
    {id:'medium',severity:'medium',summary:'medium risk',affectedArea:'evidence'},
    {id:'low',severity:'low',summary:'low risk',affectedArea:'performance'},
    {id:'low',severity:'low',summary:'duplicate should dedupe',affectedArea:'performance'},
  ]});
  assert.equal(report.overallState,'blocked');assert.deepEqual(report.blockedDependencies,['postgres']);assert.ok(report.actions.some(a=>a.category==='stop'));assert.ok(report.actions.some(a=>a.category==='repair'));assert.ok(report.actions.some(a=>a.category==='verify'));assert.ok(report.actions.some(a=>a.category==='optimize'));assert.ok(report.actions.some(a=>a.category==='monitor'));assert.equal(report.actions.filter(a=>a.id==='risk-low').length,1);assert.ok(report.decisionSummary.actNow>0);assert.ok(report.decisionSummary.verifyNext>0);assert.ok(report.decisionSummary.monitor>0);
});

test('operator action center distinguishes degraded and ready states without inventing blockers',()=>{
  const degraded=buildOperatorActionCenter({dependencies:[{id:'dependency',state:'degraded',detail:'slow',owner:'ops'}],risks:[]});assert.equal(degraded.overallState,'degraded');assert.match(degraded.headline,/usable/);
  const ready=buildOperatorActionCenter({dependencies:[{id:'dependency',state:'ready',detail:'ok',owner:'ops'}],risks:[]});assert.equal(ready.overallState,'ready');assert.equal(ready.actions.length,0);assert.match(ready.headline,/No immediate/);
});
