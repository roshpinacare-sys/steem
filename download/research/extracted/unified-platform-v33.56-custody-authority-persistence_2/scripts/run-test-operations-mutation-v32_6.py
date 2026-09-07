#!/usr/bin/env python3
from __future__ import annotations
import json,os,signal,shutil,subprocess,sys,tempfile,time
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();TEST='dist/tests/test-operations-v32_6.test.js'
MUTANTS=[
('qualification-boundary-bypass','dist/src/validation/test-operations.js','if (/linux-isolation|postgres|external-qualification/.test(file))','if (false && /linux-isolation|postgres|external-qualification/.test(file))','classification keeps qualification and deep boundaries separate'),
('deep-duration-bypass','dist/src/validation/test-operations.js','estimatedMs >= 1_500','estimatedMs >= 100_000','classification keeps qualification and deep boundaries separate'),
('invalid-shard-count-bypass','dist/src/validation/test-operations.js','shardCount < 1 || shardCount > 64','shardCount < 0 || shardCount > 64','invalid shard plans fail closed'),
('lpt-order-reversal','dist/src/validation/test-operations.js','b.estimatedMs - a.estimatedMs','a.estimatedMs - b.estimatedMs','LPT planning balances heavy tests'),
('failure-check-bypass','dist/src/validation/test-operations.js','noFailures: o.failed === 0','noFailures: true','throughput requires correctness and speed'),
('timeout-check-bypass','dist/src/validation/test-operations.js','noTimeout: o.timedOut === false','noTimeout: true','throughput requires correctness and speed'),
('stability-digest-bypass','dist/src/validation/test-operations.js','a.sourceDigest === b.sourceDigest','true || a.sourceDigest === b.sourceDigest','stability reuse requires exact identity'),
('critical-path-constant','dist/src/validation/test-operations.js','return Math.round((serial / (critical * shards.length)) * 10000) / 10000;','return 1;','critical path efficiency rewards balance'),
('distributed-duplicate-bypass','dist/src/validation/test-shard-aggregation.js','count => count === 1','count => count <= 2','aggregate rejects gaps duplicates and failures'),
('distributed-digest-bypass','dist/src/validation/test-shard-aggregation.js',"values.size === 1 && !values.has('')","values.size >= 1 && !values.has('')",'aggregate rejects every execution identity drift field'),
('dynamic-shard-floor','dist/src/validation/test-operations.js','Math.ceil(serialEstimatedMs / target)','Math.floor(serialEstimatedMs / target)','dynamic shard count scales and remains bounded'),
('quick-baseline-authority-bypass','scripts/run-tests-v32_6.py',"a.mode in('core','full')","a.mode in('quick','core','full')",'quick cannot advance authoritative baseline'),
('profile-lock-wait-as-runtime','scripts/profile-tests-v32_6.py',"'executionWallMs':round(statistics.median(execution),3)","'executionWallMs':round(statistics.median(total),3)",'profiler separates queue wait from execution'),
('exclusive-shard-bypass','dist/src/validation/test-operations.js',"const exclusive = entries.filter(e => e.resources.includes('exclusive-shard'));","const exclusive = [];",'exclusive lifecycle tests receive a dedicated distributed shard')]
def sandbox():
 d=Path(tempfile.mkdtemp(prefix='v32-6-mut-'))
 for n in ['dist','.github','scripts','config','src','tests']:shutil.copytree(ROOT/n,d/n)
 for n in ['package.json','package-lock.json','tsconfig.json']:shutil.copy2(ROOT/n,d/n)
 return d
def execute(d,pattern=None,label='baseline'):
 e=d/'evidence/runs/mutation';e.mkdir(parents=True,exist_ok=True);tap=e/f'{label}.tap.log';cmd=['node','--test',*([f'--test-name-pattern={pattern}']if pattern else[]),TEST]
 with tap.open('w')as stream:p=subprocess.Popen(cmd,cwd=d,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':'','V32_6_RUN_DIR':str(e)})
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
 basep=execute(d);baseline={'status':'passed'if basep.returncode==0 and not basep.timed_out else'failed','exitCode':basep.returncode,'timedOut':basep.timed_out,'outputTail':basep.stdout[-3000:]};print(json.dumps({'baseline':baseline['status']}),flush=True)
 if baseline['status']=='passed':
  for mid,target,old,new,marker in MUTANTS:
   path=d/target;original=path.read_text();matches=original.count(old)
   if matches!=1:rec={'mutantId':mid,'status':'not-created','matchCount':matches,'target':target}
   else:
    path.write_text(original.replace(old,new,1));shutil.rmtree(d/'evidence',ignore_errors=True);p=execute(d,marker,mid);observed=marker in p.stdout;status='invalid-kill'if p.timed_out else('killed-authentic'if p.returncode!=0 and observed else('survived'if p.returncode==0 else'invalid-kill'));rec={'mutantId':mid,'target':target,'status':status,'markerObserved':observed,'exitCode':p.returncode,'timedOut':p.timed_out,'outputTail':p.stdout[-1200:]};path.write_text(original)
   records.append(rec);print(json.dumps({'mutantId':mid,'status':rec['status']}),flush=True)
finally:shutil.rmtree(d,ignore_errors=True)
passed=baseline['status']=='passed'and len(records)==len(MUTANTS)and all(r['status']=='killed-authentic'for r in records);report={'version':'32.6.1','runId':OUT.name,'status':'passed'if passed else'failed',**ctx.execution_identity(),'baseline':baseline,'mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic'for r in records),'survivors':sum(r['status']=='survived'for r in records),'invalidKills':sum(r['status']in('invalid-kill','not-created')for r in records),'records':records};ctx.atomic_write_json(OUT/'V32_6_TEST_OPERATIONS_MUTATION_RESULTS.json',report);print(json.dumps({k:report[k]for k in('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2));raise SystemExit(0 if passed else 1)
