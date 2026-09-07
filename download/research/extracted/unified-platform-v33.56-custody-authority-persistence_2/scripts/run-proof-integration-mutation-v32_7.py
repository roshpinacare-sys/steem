#!/usr/bin/env python3
from __future__ import annotations
import json,os,signal,shutil,subprocess,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();TEST='dist/tests/proof-integration-v32_7.test.js'
MUTANTS=[
('stale-proof-bypass','dist/src/validation/proof-diversity.js','row.current && row.authentic && row.complete','true || row.current && row.authentic && row.complete','proof diversity rejects stale or inauthentic proof instead of counting volume'),
('critical-technique-floor-bypass','dist/src/validation/proof-diversity.js','critical: { techniques: 6, oracles: 2, environments: 2 }','critical: { techniques: 1, oracles: 2, environments: 2 }','critical proof minimum diversity floor rejects six-less set even without explicit techniques'),
('observed-proof-bypass','dist/src/validation/proof-diversity.js','requirement.requireObserved && !rows.some','false && requirement.requireObserved && !rows.some','proof diversity requires observed evidence when the claim demands it'),
('owner-review-conflict-bypass','dist/src/validation/integration-contract-assurance.js','row.reviewerIds.some((reviewer) => row.ownerIds.includes(reviewer))','false && row.reviewerIds.some((reviewer) => row.ownerIds.includes(reviewer))','integration owner reviewer conflicts fail closed'),
('timeout-proof-bypass','dist/src/validation/integration-contract-assurance.js',"row.criticality !== 'normal' && row.timeoutTestRefs.length === 0","false && row.criticality !== 'normal' && row.timeoutTestRefs.length === 0",'integration timeout and replay proof cannot be bypassed for critical edges'),
('authority-cycle-bypass','dist/src/validation/integration-contract-assurance.js','cycleEdges.has(`${row.sourceCapability}->${row.targetCapability}`)','false && cycleEdges.has(`${row.sourceCapability}->${row.targetCapability}`)','authority cycles across integration edges are rejected'),
('fault-disposition-bypass','dist/src/validation/integration-fault-campaign.js','row.expectedDisposition !== row.observedDisposition','false && row.expectedDisposition !== row.observedDisposition','integration fault disposition mismatch is rejected'),
('fault-side-effect-bypass','dist/src/validation/integration-fault-campaign.js',"if ((row.observedDisposition === 'BLOCK' || row.observedDisposition === 'ROLLBACK') && row.residualSideEffects !== 0)","if (false && (row.observedDisposition === 'BLOCK' || row.observedDisposition === 'ROLLBACK') && row.residualSideEffects !== 0)",'integration fault residual side effects are rejected'),
('tenant-leak-bypass','dist/src/validation/integration-fault-campaign.js','if (row.tenantLeak)','if (false && row.tenantLeak)','integration fault tenant leaks are rejected'),
('evidence-identity-bypass','dist/src/validation/governed-release-assurance.js','if (!input.evidenceIdentityCoherent)','if (false && !input.evidenceIdentityCoherent)','release assurance evidence identity check cannot be bypassed'),
('rollback-verification-bypass','dist/src/validation/governed-release-assurance.js','input.changeImpactDecision.rollbackRequired && !input.rollbackVerified','false && input.changeImpactDecision.rollbackRequired && !input.rollbackVerified','release assurance requires verified rollback for critical change'),
('production-promotion-bypass','dist/src/validation/governed-release-assurance.js',"productionPromotion: 'BLOCKED'","productionPromotion: 'ALLOWED'",'governed release assurance integrates local proofs but never promotes production'),
]
def sandbox():
 d=Path(tempfile.mkdtemp(prefix='v32-7-mut-'));shutil.copytree(ROOT/'dist',d/'dist');return d
def execute(d,pattern=None,label='baseline'):
 e=d/'evidence';e.mkdir(parents=True,exist_ok=True);tap=e/f'{label}.tap.log';cmd=['node','--test',*([f'--test-name-pattern={pattern}']if pattern else[]),TEST]
 with tap.open('w')as stream:p=subprocess.Popen(cmd,cwd=d,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''})
 try:rc=p.wait(timeout=20);timed=False
 except subprocess.TimeoutExpired:
  timed=True
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  try:rc=p.wait(timeout=2)
  except subprocess.TimeoutExpired:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   rc=p.wait(timeout=2)
 return SimpleNamespace(returncode=rc,stdout=tap.read_text(errors='replace'),timed_out=timed)
d=sandbox();records=[]
try:
 base=execute(d);baseline={'status':'passed'if base.returncode==0 and not base.timed_out else'failed','exitCode':base.returncode,'timedOut':base.timed_out,'outputTail':base.stdout[-2500:]};print(json.dumps({'baseline':baseline['status']}),flush=True)
 if baseline['status']=='passed':
  for mid,target,old,new,marker in MUTANTS:
   path=d/target;original=path.read_text();matches=original.count(old)
   if matches!=1:rec={'mutantId':mid,'target':target,'status':'not-created','matchCount':matches}
   else:
    path.write_text(original.replace(old,new,1));p=execute(d,marker,mid);observed=marker in p.stdout;status='invalid-kill'if p.timed_out else('killed-authentic'if p.returncode!=0 and observed else('survived'if p.returncode==0 else'invalid-kill'));rec={'mutantId':mid,'target':target,'status':status,'markerObserved':observed,'exitCode':p.returncode,'timedOut':p.timed_out,'outputTail':p.stdout[-1000:]};path.write_text(original)
   records.append(rec);print(json.dumps({'mutantId':mid,'status':rec['status']}),flush=True)
finally:shutil.rmtree(d,ignore_errors=True)
passed=baseline['status']=='passed'and len(records)==len(MUTANTS)and all(r['status']=='killed-authentic'for r in records);report={'version':'32.7','runId':OUT.name,'status':'passed'if passed else'failed',**ctx.execution_identity(),'baseline':baseline,'mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic'for r in records),'survivors':sum(r['status']=='survived'for r in records),'invalidKills':sum(r['status']in('invalid-kill','not-created')for r in records),'records':records};ctx.atomic_write_json(OUT/'V32_7_PROOF_INTEGRATION_MUTATION_RESULTS.json',report);print(json.dumps({k:report[k]for k in('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2));raise SystemExit(0 if passed else 1)
