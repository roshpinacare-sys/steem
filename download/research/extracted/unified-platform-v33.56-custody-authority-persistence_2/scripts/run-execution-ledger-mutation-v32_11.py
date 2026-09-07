#!/usr/bin/env python3
from __future__ import annotations
import json,os,signal,shutil,subprocess,sys,tempfile
from datetime import datetime,timezone
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();LEDGER_TEST='dist/tests/execution-ledger-assurance-v32_11.test.js';LEDGER_TARGET='dist/src/validation/execution-ledger-assurance.js';SOURCE_TEST='dist/tests/source-identity-v32_11.test.js';SOURCE_TARGET='scripts/test_ops_context_v32_6.py'
MUTANTS=[
 (LEDGER_TARGET,LEDGER_TEST,'run-id-bypass',"if (input.ledger.runId !== input.expectedRunId)","if (false && input.ledger.runId !== input.expectedRunId)",'wrong run identity and stale source identity fail closed'),
 (LEDGER_TARGET,LEDGER_TEST,'status-bypass',"if (!['validating', 'passed'].includes(input.ledger.status))","if (false && !['validating', 'passed'].includes(input.ledger.status))",'running failed and aborted ledgers cannot be finalized'),
 (LEDGER_TARGET,LEDGER_TEST,'step-order-bypass',"if (stepIds.length !== requiredIds.length || stepIds.some((id, index) => id !== requiredIds[index]))","if (false && (stepIds.length !== requiredIds.length || stepIds.some((id, index) => id !== requiredIds[index])))",'missing reordered and duplicated steps are rejected'),
 (LEDGER_TARGET,LEDGER_TEST,'step-result-bypass',"if (step.status !== 'passed' || step.exitCode !== 0 || step.timedOut)","if (false && (step.status !== 'passed' || step.exitCode !== 0 || step.timedOut))",'timeout nonzero exit and failed step are rejected independently'),
 (LEDGER_TARGET,LEDGER_TEST,'path-safety-bypass',"if (!safeArtifactPath(artifact.path, input.expectedRunPrefix))","if (false && !safeArtifactPath(artifact.path, input.expectedRunPrefix))",'path traversal absolute paths and backslashes are rejected'),
 (LEDGER_TARGET,LEDGER_TEST,'digest-size-bypass',"if (observed.sha256 !== artifact.sha256 || observed.bytes !== artifact.bytes)","if (false && (observed.sha256 !== artifact.sha256 || observed.bytes !== artifact.bytes))",'artifact digest size and missing observation mismatch are rejected'),
 (LEDGER_TARGET,LEDGER_TEST,'freshness-bypass',"if (modified !== undefined && stepStarted !== undefined && modified < stepStarted - skew)","if (false && modified !== undefined && stepStarted !== undefined && modified < stepStarted - skew)",'artifact predating its producing step is rejected as stale'),
 (LEDGER_TARGET,LEDGER_TEST,'unledgered-bypass',"if (!recordedPaths.has(path))","if (false && !recordedPaths.has(path))",'unledgered artifacts are rejected rather than silently accepted'),
 (SOURCE_TARGET,SOURCE_TEST,'source-manifest-handoff-bypass'," items.update(p.name for p in ROOT.glob('CLAUDE_HANDOFF_v*.md') if p.is_file())"," items.update([])",'source manifest automatically binds every versioned handoff'),
]
def utc():return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def sandbox():
 d=Path(tempfile.mkdtemp(prefix='v32-11-ledger-mut-'));shutil.copytree(ROOT/'dist',d/'dist');(d/'scripts').mkdir()
 shutil.copy2(ROOT/SOURCE_TARGET,d/SOURCE_TARGET)
 for path in ROOT.glob('CLAUDE_HANDOFF_v*.md'):shutil.copy2(path,d/path.name)
 for name in ('MASTER_PROMPT_v22.md','LICENSE'):
  if (ROOT/name).is_file():shutil.copy2(ROOT/name,d/name)
 return d
def execute(d:Path,test_path:str,pattern:str|None=None,label='baseline'):
 tap=d/f'{label}.tap.log';cmd=['node','--test',*([f'--test-name-pattern={pattern}']if pattern else[]),test_path]
 with tap.open('w') as stream:p=subprocess.Popen(cmd,cwd=d,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''})
 try:rc=p.wait(timeout=15);timed=False
 except subprocess.TimeoutExpired:
  timed=True
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  rc=p.wait(timeout=3)
 return SimpleNamespace(returncode=rc,stdout=tap.read_text(errors='replace'),timed_out=timed)
d=sandbox();records=[]
try:
 base=execute(d,LEDGER_TEST);source_base=execute(d,SOURCE_TEST,label='source-baseline')
 baseline_ok=all(p.returncode==0 and not p.timed_out for p in (base,source_base))
 baseline={'status':'passed' if baseline_ok else 'failed','ledger':{'exitCode':base.returncode,'timedOut':base.timed_out,'outputTail':base.stdout[-1200:]},'sourceIdentity':{'exitCode':source_base.returncode,'timedOut':source_base.timed_out,'outputTail':source_base.stdout[-1200:]}}
 print(json.dumps({'baseline':baseline['status']}),flush=True)
 if baseline['status']=='passed':
  for target,test_path,mid,old,new,marker in MUTANTS:
   path=d/target;current=path.read_text();matches=current.count(old)
   if matches!=1:rec={'mutantId':mid,'target':target,'status':'not-created','matchCount':matches}
   else:
    path.write_text(current.replace(old,new,1));p=execute(d,test_path,marker,mid);observed=marker in p.stdout
    status='invalid-kill' if p.timed_out else ('killed-authentic' if p.returncode!=0 and observed else ('survived' if p.returncode==0 else 'invalid-kill'))
    rec={'mutantId':mid,'target':target,'status':status,'markerObserved':observed,'exitCode':p.returncode,'timedOut':p.timed_out,'outputTail':p.stdout[-1200:]};path.write_text(current)
   records.append(rec);print(json.dumps({'mutantId':mid,'status':rec['status']}),flush=True)
finally:shutil.rmtree(d,ignore_errors=True)
passed=baseline['status']=='passed' and len(records)==len(MUTANTS) and all(r['status']=='killed-authentic' for r in records)
report={'version':'32.11','runId':OUT.name,'generatedAt':utc(),'status':'passed' if passed else 'failed',**ctx.execution_identity(),'baseline':baseline,'mutantsSpecified':len(MUTANTS),'mutantsKilledAuthentically':sum(r['status']=='killed-authentic' for r in records),'survivors':sum(r['status']=='survived' for r in records),'invalidKills':sum(r['status'] in ('invalid-kill','not-created') for r in records),'records':records}
ctx.atomic_write_json(OUT/'V32_11_EXECUTION_LEDGER_MUTATION_RESULTS.json',report);print(json.dumps({k:report[k] for k in ('status','mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},indent=2));raise SystemExit(0 if passed else 1)
