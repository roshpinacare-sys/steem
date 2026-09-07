#!/usr/bin/env python3
from __future__ import annotations
import json,os,signal,shutil,subprocess,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();TEST='dist/tests/claim-execution-closure-v32_9.test.js'
MUTANTS=[
 ('synthetic-digest-bypass','dist/src/validation/evidence-artifact-binding.js','if (!HEX.test(input.declaredDigest) || repeated(input.declaredDigest))','if (!HEX.test(input.declaredDigest) || false)','artifact binding rejects repeated synthetic digest'),
 ('digest-match-bypass','dist/src/validation/evidence-artifact-binding.js','if (actualDigest !== input.declaredDigest)','if (false && actualDigest !== input.declaredDigest)','artifact binding rejects digest mismatch'),
 ('identity-binding-bypass','dist/src/validation/evidence-artifact-binding.js','if (input.sourceDigest !== policy.sourceDigest)','if (false && input.sourceDigest !== policy.sourceDigest)','artifact binding rejects execution identity drift'),
 ('file-origin-bypass','dist/src/validation/evidence-artifact-binding.js',"if (input.origin !== 'FILE')","if (false && input.origin !== 'FILE')",'artifact binding rejects inline evidence'),
 ('self-review-bypass','dist/src/validation/evidence-artifact-binding.js','if (!input.producerId || !input.reviewerId || input.producerId === input.reviewerId)','if (!input.producerId || !input.reviewerId || false)','artifact binding rejects self review'),
 ('description-predicate-bypass','dist/src/validation/description-contract-assurance.js','if (markerCount !== 1)','if (false)','description contract rejects duplicate marker'),
 ('external-description-bypass','dist/src/validation/description-contract-assurance.js',"if (i.scope !== 'LOCAL' && i.evidenceOrigin === 'LOCAL')","if (false && i.scope !== 'LOCAL' && i.evidenceOrigin === 'LOCAL')",'description contract rejects local proof for external claim'),
 ('dag-cycle-bypass','dist/src/validation/evidence-dependency-dag.js','if (visiting.has(id))','if (false && visiting.has(id))','evidence DAG rejects a pure dependency cycle without relying on other findings'),
 ('dag-producer-dependency-bypass','dist/src/validation/evidence-dependency-dag.js','else if (p !== s.stageId && !ancestors(s.stageId).has(p))','else if (false && p !== s.stageId && !ancestors(s.stageId).has(p))','evidence DAG rejects undeclared artifact dependency'),
 ('utilization-callsite-bypass','dist/src/validation/capability-utilization-assurance.js','if (!call.includes(i.exportedSymbol) && !call.includes(i.capabilityId))','if (false && !call.includes(i.exportedSymbol) && !call.includes(i.capabilityId))','capability utilization blocks missing callsite'),
 ('closure-gate-bypass','dist/src/validation/claim-execution-assurance.js',"if (g.status !== 'PASS')","if (false && g.status !== 'PASS')",'claim execution closure blocks failed gate'),
 ('refutation-floor-bypass','dist/src/validation/claim-execution-assurance.js','if (input.actualRefutations < input.expectedRefutations)','if (false && input.actualRefutations < input.expectedRefutations)','claim execution closure requires unsupported claim refutation floor'),
]
def sandbox():
 d=Path(tempfile.mkdtemp(prefix='v32-9-mut-'));shutil.copytree(ROOT/'dist',d/'dist');return d
def execute(d:Path,pattern:str|None=None,label='baseline'):
 e=d/'evidence';e.mkdir(parents=True,exist_ok=True);tap=e/f'{label}.tap.log';cmd=['node','--test',*([f'--test-name-pattern={pattern}']if pattern else[]),TEST]
 with tap.open('w') as stream:p=subprocess.Popen(cmd,cwd=d,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''})
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
 base=execute(d);baseline={'status':'passed' if base.returncode==0 and not base.timed_out else 'failed','exitCode':base.returncode,'timedOut':base.timed_out,'outputTail':base.stdout[-2500:]};print(json.dumps({'baseline':baseline['status']}),flush=True)
 if baseline['status']=='passed':
  for mid,target,old,new,marker in MUTANTS:
   path=d/target;original=path.read_text();matches=original.count(old)
   if matches!=1:rec={'mutantId':mid,'target':target,'status':'not-created','matchCount':matches}
   else:
    path.write_text(original.replace(old,new,1));p=execute(d,marker,mid);observed=marker in p.stdout
    status='invalid-kill' if p.timed_out else ('killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill'))
    rec={'mutantId':mid,'target':target,'status':status,'markerObserved':observed,'exitCode':p.returncode,'timedOut':p.timed_out,'outputTail':p.stdout[-1200:]};path.write_text(original)
   records.append(rec);print(json.dumps({'mutantId':mid,'status':rec['status']}),flush=True)
finally:shutil.rmtree(d,ignore_errors=True)
passed=baseline['status']=='passed' and len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'32.9','runId':OUT.name,'status':'passed' if passed else 'failed',**ctx.execution_identity(),'baseline':baseline,'mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records}
ctx.atomic_write_json(OUT/'V32_9_CLAIM_EXECUTION_MUTATION_RESULTS.json',report);print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2));raise SystemExit(0 if passed else 1)
