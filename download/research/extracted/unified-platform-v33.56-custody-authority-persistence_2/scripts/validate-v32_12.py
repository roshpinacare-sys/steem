#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,os,signal,shutil,subprocess,sys,time
from datetime import datetime,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_ops_context_v32_6 as ctx

ROOT=ctx.ROOT
RUN_ID=ctx.sanitize_run_id(os.environ.get('V32_6_RUN_ID','v32.12-local-validation'))
OUT=ROOT/'evidence/runs'/RUN_ID
LEDGER_PATH=OUT/'V32_12_EXECUTION_LEDGER.json'
LOG_DIR=OUT/'logs'
ledger:dict={}
active_step='initialization'


def utc()->str:return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def raw_sha(path:Path)->str:return hashlib.sha256(path.read_bytes()).hexdigest()
def atomic(path:Path,value:dict)->None:ctx.atomic_write_json(path,value)
def write_ledger()->None:
 ledger['updatedAt']=utc();atomic(LEDGER_PATH,ledger)
def fail_run(reason:str,exit_code:int=1)->None:
 ledger['status']='failed';ledger['failure']={'step':active_step,'reason':reason,'recordedAt':utc()};write_ledger();print(json.dumps({'status':'failed','step':active_step,'reason':reason,'ledger':str(LEDGER_PATH.relative_to(ROOT))},indent=2),file=sys.stderr);raise SystemExit(exit_code)
def signal_handler(signum,frame):
 ledger['status']='aborted';ledger['failure']={'step':active_step,'reason':f'signal:{signum}','recordedAt':utc()};write_ledger();raise SystemExit(128+signum)


def artifact_record(name:str)->dict:
 path=OUT/name
 if not path.is_file():raise FileNotFoundError(f'required_artifact_missing:{name}')
 stat=path.stat()
 return {'path':path.relative_to(ROOT).as_posix(),'sha256':raw_sha(path),'bytes':stat.st_size}


def run_step(step_id:str,command:list[str],timeout_s:int,artifacts:list[str],after=None)->None:
 global active_step
 active_step=step_id
 sequence=len(ledger['steps'])+1
 started=utc();log_path=LOG_DIR/f'{sequence:02d}-{step_id}.log'
 print(f'== {step_id} ==',flush=True)
 timed_out=False;exit_code=None
 with log_path.open('w') as stream:
  process=subprocess.Popen(command,cwd=ROOT,env={**os.environ,'V32_6_RUN_ID':RUN_ID,'V32_6_RUN_DIR':str(OUT),'NODE_ENV':'test','NODE_OPTIONS':''},stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
  try:exit_code=process.wait(timeout=timeout_s)
  except subprocess.TimeoutExpired:
   timed_out=True
   try:os.killpg(process.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:exit_code=process.wait(timeout=3)
   except subprocess.TimeoutExpired:
    try:os.killpg(process.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    exit_code=process.wait(timeout=3)
 finished=utc()
 if exit_code==0 and not timed_out and after is not None:after()
 records=[]
 artifact_error=None
 if exit_code==0 and not timed_out:
  try:records=[artifact_record(name) for name in artifacts]
  except Exception as exc:artifact_error=str(exc)
 status='timed-out' if timed_out else 'passed' if exit_code==0 and artifact_error is None else 'failed'
 ledger['steps'].append({'id':step_id,'sequence':sequence,'command':command,'startedAt':started,'finishedAt':finished,'status':status,'exitCode':exit_code,'timedOut':timed_out,'artifacts':records,'logPath':log_path.relative_to(ROOT).as_posix()})
 write_ledger()
 print(json.dumps({'step':step_id,'status':status,'exitCode':exit_code,'timedOut':timed_out,'artifacts':[x['path'] for x in records]},indent=2),flush=True)
 if status!='passed':
  tail=log_path.read_text(errors='replace')[-12000:]
  if tail:print(tail,file=sys.stderr)
  fail_run(artifact_error or f'step_{status}:{step_id}',124 if timed_out else (exit_code or 1))


def build_identity()->None:
 report={'version':'32.12','runId':RUN_ID,'generatedAt':utc(),'status':'passed',**ctx.execution_identity(),'classification':'fresh-clean-build-identity'}
 atomic(OUT/'V32_12_BUILD_IDENTITY.json',report)


def completion_report()->dict:
 final=artifact_record('V32_12_FINAL_VALIDATION.json')
 ledger_artifact=artifact_record('V32_12_EXECUTION_LEDGER.json')
 return {'version':'32.12','runId':RUN_ID,'generatedAt':utc(),'status':'passed','sourceDigest':ledger['sourceDigest'],'stepsPassed':len(ledger['steps']),'ledger':ledger_artifact,'finalValidation':final,'productionPromotion':'blocked','externalQualification':'not-executed'}


def verify_completed_step(step:dict)->None:
 if step.get('status')!='passed' or step.get('exitCode')!=0 or step.get('timedOut') is not False:raise RuntimeError(f"resume_step_not_passed:{step.get('id')}")
 for record in step.get('artifacts',[]):
  path=ROOT/record['path']
  if not path.is_file() or raw_sha(path)!=record['sha256'] or path.stat().st_size!=record['bytes']:raise RuntimeError(f"resume_artifact_drift:{record.get('path')}")

def main()->int:
 global ledger,active_step
 resume=os.environ.get('V32_12_RESUME')=='1'
 max_steps=int(os.environ.get('V32_12_MAX_STEPS','999'))
 if max_steps<1:raise SystemExit('V32_12_MAX_STEPS_must_be_positive')
 signal.signal(signal.SIGTERM,signal_handler);signal.signal(signal.SIGINT,signal_handler)
 if resume:
  if not LEDGER_PATH.is_file():raise SystemExit('resume_ledger_missing')
  ledger=json.loads(LEDGER_PATH.read_text())
  if ledger.get('version')!='32.12' or ledger.get('runId')!=RUN_ID:raise SystemExit('resume_ledger_identity_mismatch')
  if ledger.get('sourceDigest')!=ctx.source_digest():raise SystemExit('source_digest_changed_resume_forbidden')
  if ledger.get('status') not in ('running','aborted','validating'):raise SystemExit(f"resume_status_forbidden:{ledger.get('status')}")
  for step in ledger.get('steps',[]):verify_completed_step(step)
  ledger.pop('failure',None);ledger['status']='running';write_ledger();LOG_DIR.mkdir(parents=True,exist_ok=True)
 else:
  if OUT.exists():shutil.rmtree(OUT)
  LOG_DIR.mkdir(parents=True,exist_ok=True)
  ledger={'version':'32.12','runId':RUN_ID,'status':'running','startedAt':utc(),'updatedAt':utc(),'sourceDigest':ctx.source_digest(),'steps':[],'productionPromotion':'blocked'}
  write_ledger()
 specs=[
  ('repository-truth-map',['node','scripts/repository-truth-map-v32_12.mjs'],120,['V32_12_REPOSITORY_TRUTH_MAP.json'],None),
  ('clean-build',['npm','run','build:clean:v32'],180,['V32_12_BUILD_IDENTITY.json'],build_identity),
  ('full-regression',['python3','scripts/run-tests-v32_6.py','--mode','full','--no-build'],360,['V32_6_FULL_TEST_RESULTS.json'],None),
  ('local-assurance-mutation-v32.10',['python3','scripts/run-local-assurance-mutation-v32_10.py'],420,['V32_10_LOCAL_ASSURANCE_MUTATION_RESULTS.json'],None),
  ('execution-ledger-mutation-v32.11',['python3','scripts/run-execution-ledger-mutation-v32_11.py'],300,['V32_11_EXECUTION_LEDGER_MUTATION_RESULTS.json'],None),
  ('external-integrity-mutation-v32.12',['python3','scripts/run-external-integrity-mutation-v32_12.py'],300,['V32_12_EXTERNAL_INTEGRITY_MUTATION_RESULTS.json'],None),
  ('coverage',['node','scripts/run-coverage-v32.mjs'],300,['V32_COVERAGE_REPORT.json'],None),
  ('test-quality',['node','scripts/test-quality-audit-v32.mjs'],180,['V32_TEST_QUALITY_AUDIT.json'],None),
  ('architecture',['node','scripts/architecture-validation-v32.mjs'],180,['V32_ARCHITECTURE_INTEGRITY.json'],None),
  ('external-readiness',['node','scripts/external-qualification-readiness-cycle-v32_12.mjs'],120,['V32_12_EXTERNAL_QUALIFICATION_READINESS.json'],None),
  ('release-final',['node','scripts/validate-v32_12.mjs'],180,['V32_12_FINAL_VALIDATION.json'],None),
 ]
 completed={step['id'] for step in ledger.get('steps',[]) if step.get('status')=='passed'};executed=0
 try:
  for step_id,command,timeout_s,artifacts,after in specs:
   if step_id in completed:continue
   if step_id=='release-final':ledger['status']='validating';write_ledger()
   run_step(step_id,command,timeout_s,artifacts,after);executed+=1
   if executed>=max_steps:break
  passed_ids={step['id'] for step in ledger['steps'] if step.get('status')=='passed'}
  all_done=all(step_id in passed_ids for step_id,_,_,_,_ in specs)
  if not all_done:
   ledger['status']='running';write_ledger();remaining=[step_id for step_id,_,_,_,_ in specs if step_id not in passed_ids]
   print(json.dumps({'status':'partial','runId':RUN_ID,'stepsPassed':len(passed_ids),'nextStep':remaining[0]},indent=2));return 0
  ledger['status']='passed';write_ledger()
  report=completion_report();atomic(OUT/'V32_12_EXECUTION_COMPLETION.json',report)
  print(json.dumps(report,indent=2));return 0
 except SystemExit:raise
 except Exception as exc:fail_run(f'unhandled:{type(exc).__name__}:{exc}')
 return 1

if __name__=='__main__':raise SystemExit(main())
