#!/usr/bin/env python3
from __future__ import annotations
import json,os,re,shutil,signal,subprocess,time,uuid
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];EVIDENCE=ROOT/'evidence';GENERATED=EVIDENCE/'generated';LOCK=EVIDENCE/'.validation-v26.lock';RUN_ID=f'v26-{uuid.uuid4()}'
def utc():return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def atomic_json(path,value):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_name(f'.{path.name}.{os.getpid()}.{uuid.uuid4()}.tmp');tmp.write_text(json.dumps(value,indent=2)+'\n');
 with tmp.open('rb') as h:os.fsync(h.fileno())
 os.replace(tmp,path)
def alive(pid):
 try:os.kill(pid,0);return True
 except (ProcessLookupError,PermissionError):return False
def acquire():
 EVIDENCE.mkdir(parents=True,exist_ok=True)
 for _ in range(2):
  try:
   fd=os.open(LOCK,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.write(fd,(json.dumps({'pid':os.getpid(),'runId':RUN_ID,'createdAt':utc()})+'\n').encode());os.fsync(fd);os.close(fd);return
  except FileExistsError:
   try:row=json.loads(LOCK.read_text())
   except Exception:row={}
   pid=row.get('pid') if isinstance(row.get('pid'),int) else -1
   if not alive(pid):LOCK.rename(LOCK.with_name(f'.validation-v26.stale-{int(time.time())}-{uuid.uuid4()}'));continue
   raise RuntimeError(f'validation_already_running:{row}')
 raise RuntimeError('validation_lock_unrecoverable')
def cleanup():
 marker=f'V26_VALIDATION_RUN_ID={RUN_ID}'.encode();killed=[];proc=Path('/proc')
 if not proc.exists():return killed
 for e in proc.iterdir():
  if not e.name.isdigit() or int(e.name)==os.getpid():continue
  try:
   if marker in (e/'environ').read_bytes().split(b'\0'):os.kill(int(e.name),signal.SIGTERM);killed.append(int(e.name))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
 time.sleep(.25)
 for pid in killed:
  try:os.kill(pid,signal.SIGKILL)
  except (ProcessLookupError,PermissionError):pass
 return killed
def stage(name,cmd,timeout,acceptable=(0,),classes=None):
 started=utc();clock=time.monotonic();log=GENERATED/f'{name}.log';timed=False;env={**os.environ,'V26_VALIDATION_RUN_ID':RUN_ID,'NODE_ENV':'test','NODE_OPTIONS':'','V26_TEST_WORKERS':'4','V26_TEST_CAPACITY':'5'}
 with log.open('w') as out:
  p=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=out,stderr=subprocess.STDOUT,text=True,start_new_session=True)
  try:p.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   timed=True
   try:os.killpg(p.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:p.wait(timeout=5)
   except subprocess.TimeoutExpired:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    p.wait(timeout=5)
 status='timed-out' if timed else ((classes or {}).get(p.returncode,'passed') if p.returncode in acceptable else 'failed')
 return {'name':name,'command':cmd,'startedAt':started,'durationMs':round((time.monotonic()-clock)*1000,3),'exitCode':p.returncode,'timedOut':timed,'status':status,'acceptableExitCodes':list(acceptable),'log':str(log.relative_to(ROOT))}
def load(name):
 try:return json.loads((GENERATED/name).read_text())
 except Exception:return {}
def main():
 acquire();started=utc();quarantine=None;records=[];interrupted=False
 try:
  if GENERATED.exists():
   quarantine=EVIDENCE/'quarantine'/f'{int(time.time())}-{RUN_ID}';quarantine.parent.mkdir(parents=True,exist_ok=True);GENERATED.rename(quarantine)
  GENERATED.mkdir(parents=True,exist_ok=False);atomic_json(GENERATED/'V26_VALIDATION_IN_PROGRESS.json',{'version':'26.0','runId':RUN_ID,'pid':os.getpid(),'startedAt':started,'quarantinedPriorEvidence':str(quarantine.relative_to(ROOT)) if quarantine else None})
  for path in [ROOT/'dist',ROOT/'coverage',ROOT/'.cache']:
   if path.exists():shutil.rmtree(path)
  plan=[
   ('build',['npm','run','build:clean:v26'],120,(0,),None),('prepare-isolation',['bash','scripts/prepare-linux-probes-v26.sh'],120,(0,),None),('tests',['python3','scripts/run-tests-v26-parallel.py'],180,(0,),None),('test-quality',['node','scripts/test-quality-audit-v26.mjs'],60,(0,),None),('incomplete-code-audit',['node','scripts/incomplete-code-audit-v26.mjs'],60,(0,),None),('coverage',['node','scripts/run-coverage-v26.mjs'],300,(0,),None),('mutation',['python3','scripts/run-mutation-v26.py'],900,(0,),None),('design-closure',['node','scripts/design-closure-v26.mjs'],60,(0,),None),('supply-chain',['node','scripts/supply-chain-report-v26.mjs'],120,(0,),None),('invariants',['node','scripts/invariant-coverage-v26.mjs'],60,(0,),None),('local-dr',['node','scripts/local-dr-rehearsal-v26.mjs'],90,(0,),None),('pilot-protocol',['node','scripts/generate-human-pilot-v26.mjs'],45,(0,),None),('environment',['node','scripts/probe-environment-v26.mjs'],60,(0,),None),('postgres-qualification',['node','scripts/qualify-postgres-v26.mjs'],180,(0,2),{2:'environment-blocked'}),('linux-isolation',['bash','scripts/run-linux-isolation-v26.sh'],120,(0,),None),('browser-e2e',['python3','e2e/test_breakthrough_pilot_v26.py'],240,(0,),None),('local-performance',['node','scripts/benchmark-v26.mjs'],120,(0,),None),('operations-report',['node','scripts/generate-operations-report-v26.mjs'],60,(0,),None),('stability',['python3','scripts/stability-v26.py'],420,(0,),None),('qualification-matrix',['node','scripts/qualification-matrix-v26.mjs'],60,(0,),None)]
  for item in plan:
   r=stage(*item);records.append(r);atomic_json(GENERATED/'V26_COMMAND_RECORD.partial.json',{'version':'26.0','runId':RUN_ID,'commands':records})
   if r['status'] in ('failed','timed-out'):break
  orphans=cleanup();tests=load('V26_TEST_RESULTS.json');mutation=load('V26_MUTATION_RESULTS.json');quality=load('V26_TEST_QUALITY_AUDIT.json');incomplete=load('V26_INCOMPLETE_CODE_AUDIT.json');design=load('V26_DESIGN_CLOSURE.json');stability=load('V26_STABILITY_REPORT.json');pg=load('V26_POSTGRES_QUALIFICATION.json');perf=load('V26_LOCAL_PERFORMANCE.json');qualification=load('V26_QUALIFICATION_MATRIX.json');isolation=load('V26_LINUX_ISOLATION.json');ops=load('V26_OPERATIONAL_ACTION_CENTER.json');supply=load('V26_SUPPLY_CHAIN_REPORT.json');invariants=load('V26_INVARIANT_COVERAGE.json');dr=load('V26_LOCAL_DR_REHEARSAL.json');browser=load('V26_BROWSER_E2E.json');pilot=load('V26_HUMAN_PILOT_PROTOCOL.json');coverage=(GENERATED/'v26-coverage.log').read_text(errors='replace') if (GENERATED/'v26-coverage.log').exists() else '';m=re.search(r'^# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)',coverage,re.M);tot=tests.get('totals',{});inv=tests.get('inventory',{})
  checks={'allStagesAcceptable':len(records)==len(plan) and not any(x['status'] in ('failed','timed-out') for x in records),'completeSuite':tests.get('status')=='passed' and tot.get('tests')==311 and tot.get('passed')==311 and tot.get('failed')==0 and tot.get('testFiles')==62 and all(inv.get(k)==[] for k in ('missing','extra','duplicates','compiledMissing')),'noTestReduction':tot.get('tests',0)>=288,'mutationAuthentic':mutation.get('status')=='passed' and mutation.get('mutantsCreated')==37 and mutation.get('mutantsKilledAuthentically')==37 and mutation.get('invalidKills')==0 and mutation.get('mutantsSurvived')==0,'qualityClean':quality.get('status')=='passed' and quality.get('filesAudited')==62 and quality.get('testsDeclared')==311 and quality.get('criticalOrHighIssues')==0 and quality.get('mediumIssues')==0,'incompleteCodeClosed':incomplete.get('status')=='passed' and not incomplete.get('explicitIncompleteMarkers') and not incomplete.get('packageScriptTargets',{}).get('missing') and not incomplete.get('criticalIntegrationGaps'),'designClosure':design.get('status')=='passed' and design.get('claims')==4 and design.get('closed')==4 and design.get('coveragePercent')==100,'coverageMeasured':bool(m) and float(m.group(1))>=96 and float(m.group(2))>=83 and float(m.group(3))>=97,'stability':stability.get('status')=='passed' and stability.get('flakeCount')==0 and len(stability.get('runs',[]))==3 and all(x.get('tests')==311 and x.get('failed')==0 for x in stability.get('runs',[])),'performanceMeasuredHonestly':perf.get('status')=='measured-local-only' and perf.get('fullSuite',{}).get('current',{}).get('tests')==311,'supplyChain':supply.get('status')=='passed' and supply.get('npmAudit',{}).get('total')==0 and supply.get('archiveSelftest',{}).get('status')=='passed','criticalInvariants':invariants.get('status')=='passed' and invariants.get('invariants')==11 and invariants.get('fullyCovered')==11 and invariants.get('coveragePercent')==100,'localRecovery':dr.get('status')=='passed-local-rehearsal','browserWorkflow':browser.get('status')=='passed' and browser.get('health',{}).get('version')=='v26','isolationResearchProof':isolation.get('status')=='passed-single-host-research-proof' and isolation.get('version')=='26.0','operationsFailClosed':ops.get('status')=='passed' and ops.get('center',{}).get('overallState')=='blocked' and ops.get('lifecycle',{}).get('verified') is True,'humanClaimsBounded':pilot.get('status')=='protocol-ready-not-executed' and pilot.get('version')=='26.0','qualificationHonest':qualification.get('readiness')=='Integrated Pilot' and qualification.get('productionPromotion')=='blocked' and not qualification.get('hardFailures'),'postgresExplicit':pg.get('status') in ('environment-blocked','implemented-and-exercised-single-database'),'governanceVersion':json.loads((ROOT/'governance-state/PROGRAM_STATE.json').read_text()).get('version')=='26.0','noTaggedOrphans':not orphans}
  status='passed' if all(checks.values()) else 'failed';report={'version':'26.0','ownerRole':'Independent Validation, Design Closure, Recovery, Agent Governance and Domain Admission Leads','status':status,'runId':RUN_ID,'startedAt':started,'finishedAt':utc(),'cleanState':{'priorGeneratedEvidenceQuarantined':quarantine is not None,'priorEvidencePath':str(quarantine.relative_to(ROOT)) if quarantine else None,'distCoverageAndCacheRemoved':True,'exclusiveLease':True,'leftoverTaggedProcesses':orphans},'stages':records,'checks':checks,'tests':tot,'testInventory':inv,'coverage':{'linePercent':float(m.group(1)) if m else None,'branchPercent':float(m.group(2)) if m else None,'functionPercent':float(m.group(3)) if m else None},'mutation':{k:mutation.get(k) for k in ('status','mutantsCreated','mutantsKilledAuthentically','mutantsSurvived','invalidKills','mutationScorePercent','resumedAuthenticKills')},'designClosure':{k:design.get(k) for k in ('status','claims','closed','blocked','coveragePercent')},'invariantCoverage':{k:invariants.get(k) for k in ('status','invariants','fullyCovered','coveragePercent')},'stability':stability.get('statistics',{}),'performance':perf,'incompleteCodeAudit':{'status':incomplete.get('status'),'unreferencedExportCandidates':len(incomplete.get('unreferencedExportCandidates',[]))},'postgres':pg,'qualification':qualification,'acceptance':{'v26PersistentClosureIntegratedPilot':'met' if status=='passed' else 'not-met','production':'not-met'},'limitations':['single-host local proof','PostgreSQL primary/standby unavailable','no real KMS/HSM','isolation not independently certified','no external penetration or legal review','human pilot not executed','local performance is not a production SLO'],'confidence':'high for local persistence, request binding, approval lineage, test authenticity and design-to-evidence closure; low for external qualification','independentVerificationStatus':'role-separated self-contained adversarial validation, not external certification','nextAction':'Run v27 external qualification only.'}
  atomic_json(GENERATED/'V26_FINAL_VALIDATION.json',report);atomic_json(GENERATED/'V26_CLEAN_STATE_VALIDATION.json',report['cleanState']|{'version':'26.0','status':status,'runId':RUN_ID});atomic_json(GENERATED/'V26_COMMAND_RECORD.json',{'version':'26.0','runId':RUN_ID,'commands':records});(GENERATED/'V26_COMMAND_RECORD.partial.json').unlink(missing_ok=True);(GENERATED/'V26_VALIDATION_IN_PROGRESS.json').unlink(missing_ok=True);atomic_json(GENERATED/'V26_VALIDATION_COMPLETED.json',{'version':'26.0','runId':RUN_ID,'status':status,'finishedAt':utc()});print(json.dumps({'status':status,'tests':tot,'coverage':report['coverage'],'mutation':report['mutation'],'designClosure':report['designClosure'],'invariants':report['invariantCoverage'],'postgresStatus':pg.get('status'),'failedChecks':[k for k,v in checks.items() if not v]},indent=2));return 0 if status=='passed' else 1
 except KeyboardInterrupt:
  interrupted=True;cleanup();raise
 finally:
  try:LOCK.unlink()
  except FileNotFoundError:pass
  if interrupted and GENERATED.exists():atomic_json(GENERATED/'V26_VALIDATION_INTERRUPTED.json',{'version':'26.0','runId':RUN_ID,'interruptedAt':utc()})
if __name__=='__main__':raise SystemExit(main())
