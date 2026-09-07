#!/usr/bin/env python3
from __future__ import annotations

import json, os, re, shutil, signal, subprocess, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'evidence'; GENERATED=EVIDENCE/'generated'; LOCK=EVIDENCE/'.validation-v24.lock'
RUN_ID=f'v24-{uuid.uuid4()}'
WRITE_LOCK=threading.Lock()

def utc()->str:return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def atomic_json(path:Path,value:object)->None:
    path.parent.mkdir(parents=True,exist_ok=True); tmp=path.with_name(f'.{path.name}.{os.getpid()}.{uuid.uuid4()}.tmp'); tmp.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8'); os.replace(tmp,path)

def pid_alive(pid:int)->bool:
    try: os.kill(pid,0); return True
    except (ProcessLookupError,PermissionError): return False

def acquire_lock()->None:
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    for _ in range(2):
        try:
            fd=os.open(LOCK,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600); os.write(fd,(json.dumps({'pid':os.getpid(),'runId':RUN_ID,'createdAt':utc()})+'\n').encode()); os.fsync(fd); os.close(fd); return
        except FileExistsError:
            try: current=json.loads(LOCK.read_text())
            except Exception: current={}
            pid=current.get('pid') if isinstance(current.get('pid'),int) else -1
            if not pid_alive(pid): LOCK.rename(LOCK.with_name(f'.validation-v24.stale-{int(time.time())}-{uuid.uuid4()}')); continue
            raise RuntimeError(f'validation_already_running:{current}')
    raise RuntimeError('validation_lock_unrecoverable')

def cleanup_tagged_processes()->list[int]:
    killed=[]; proc=Path('/proc'); marker=f'V24_VALIDATION_RUN_ID={RUN_ID}'.encode()
    if not proc.exists(): return killed
    for entry in proc.iterdir():
        if not entry.name.isdigit() or int(entry.name)==os.getpid(): continue
        try:
            if marker in (entry/'environ').read_bytes().split(b'\0'):
                os.kill(int(entry.name),signal.SIGTERM); killed.append(int(entry.name))
        except (FileNotFoundError,ProcessLookupError,PermissionError): pass
    time.sleep(.25)
    for pid in killed:
        try: os.kill(pid,signal.SIGKILL)
        except (ProcessLookupError,PermissionError): pass
    return killed

def run_stage(name:str,command:list[str],timeout:int,acceptable:tuple[int,...]=(0,),classification_by_code:dict[int,str]|None=None,stdout_file:str|None=None)->dict:
    started_at=utc(); started=time.monotonic(); log=GENERATED/f'{name}.log'
    env={**os.environ,'V24_VALIDATION_RUN_ID':RUN_ID,'NODE_ENV':'test','NODE_OPTIONS':''}
    process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
    timed_out=False
    try: output,_=process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out=True; os.killpg(process.pid,signal.SIGTERM)
        try: output,_=process.communicate(timeout=4)
        except subprocess.TimeoutExpired: os.killpg(process.pid,signal.SIGKILL); output,_=process.communicate()
    duration=round((time.monotonic()-started)*1000,3); log.write_text(output or '',encoding='utf-8')
    if stdout_file and process.returncode in acceptable and not timed_out: (GENERATED/stdout_file).write_text(output or '',encoding='utf-8')
    if timed_out: status='timed-out'
    elif process.returncode in acceptable: status=(classification_by_code or {}).get(process.returncode,'passed')
    else: status='failed'
    return {'name':name,'command':command,'startedAt':started_at,'durationMs':duration,'exitCode':process.returncode,'timedOut':timed_out,'status':status,'acceptableExitCodes':list(acceptable),'log':str(log.relative_to(ROOT))}

def load(name:str)->dict:
    path=GENERATED/name
    try:return json.loads(path.read_text())
    except Exception:return {}

def main()->int:
    acquire_lock(); started_at=utc(); quarantine=None; stages=[]; interrupted=False
    try:
        if GENERATED.exists():
            quarantine=EVIDENCE/'quarantine'/f'{int(time.time())}-{RUN_ID}'; quarantine.parent.mkdir(parents=True,exist_ok=True); GENERATED.rename(quarantine)
        GENERATED.mkdir(parents=True,exist_ok=False)
        atomic_json(GENERATED/'V24_VALIDATION_IN_PROGRESS.json',{'version':'24.0','runId':RUN_ID,'pid':os.getpid(),'startedAt':started_at,'quarantinedPriorEvidence':str(quarantine.relative_to(ROOT)) if quarantine else None})
        for path in [ROOT/'dist',ROOT/'coverage',ROOT/'.cache']:
            if path.exists(): shutil.rmtree(path)
        sequential=[
          ('build',['npm','run','build'],90),
          ('prepare-isolation',['bash','scripts/prepare-linux-probes-v24.sh'],90),
          ('tests',['python3','scripts/run-tests-v24-parallel.py'],150),
          ('test-profile-initial',['python3','scripts/profile-tests-v24.py'],30),
        ]
        for name,command,timeout in sequential:
            record=run_stage(name,command,timeout); stages.append(record)
            if record['status']!='passed': break
        if all(record['status']=='passed' for record in stages):
            parallel_specs=[
              ('coverage',['node','scripts/run-coverage-v24.mjs'],220,(0,),None,None),
              ('environment',['node','scripts/probe-environment-v24.mjs'],45,(0,),None,None),
              ('postgres-qualification',['node','scripts/qualify-postgres-v24.mjs'],110,(0,2),{2:'environment-blocked'},None),
              ('linux-isolation',['bash','scripts/run-linux-isolation-v24.sh'],75,(0,),None,None),
              ('browser-e2e',['python3','e2e/test_breakthrough_pilot_v24.py'],150,(0,),None,None),
              ('pilot-protocol',['node','scripts/generate-human-pilot-v24.mjs'],30,(0,),None,None),
              ('local-dr',['node','scripts/local-dr-rehearsal-v24.mjs'],45,(0,),None,None),
              ('mutation',['python3','scripts/run-mutation-v24.py'],210,(0,),None,None),
              ('test-quality',['node','scripts/test-quality-audit-v24.mjs'],45,(0,),None,None),
              ('impact-plan',['python3','scripts/run-impacted-tests-v24.py','--plan-only'],45,(0,),None,None),
              ('npm-audit',['npm','audit','--json'],45,(0,),None,'npm-audit-v24.raw.json'),
            ]
            records=[]
            with ThreadPoolExecutor(max_workers=4,thread_name_prefix='v24-validation') as pool:
                futures={pool.submit(run_stage,*spec):spec[0] for spec in parallel_specs}
                for future in as_completed(futures): records.append(future.result())
            records.sort(key=lambda item:item['name']); stages.extend(records)
        critical_failed=any(item['status'] in ('failed','timed-out') for item in stages)
        if not critical_failed:
            # Latency evidence is intentionally collected outside coverage, mutation,
            # browser and isolation load. The first v24 run proved that colocating the
            # benchmark can create a false regression (WASM p95 388 ms under contention).
            for spec in [
              ('local-performance',['node','scripts/benchmark-v24.mjs'],150),
              ('stability',['python3','scripts/stability-v24.py'],360),
              ('test-profile-final',['python3','scripts/profile-tests-v24.py'],30),
              ('operations-report',['node','scripts/generate-operations-report-v24.mjs'],30),
              ('qualification-matrix',['node','scripts/qualification-matrix-v24.mjs'],45),
            ]:
                record=run_stage(*spec); stages.append(record)
                if record['status']!='passed': break
        orphans=cleanup_tagged_processes()
        tests=load('V24_TEST_RESULTS.json'); mutation=load('V24_MUTATION_RESULTS.json'); quality=load('V24_TEST_QUALITY_AUDIT.json'); stability=load('V24_STABILITY_REPORT.json'); pg=load('V24_POSTGRES_QUALIFICATION.json'); perf=load('V24_LOCAL_PERFORMANCE.json'); qualification=load('V24_QUALIFICATION_MATRIX.json'); isolation=load('V24_LINUX_ISOLATION.json'); ops=load('V24_OPERATIONAL_ACTION_CENTER.json'); impact=load('V24_IMPACT_TEST_RESULTS.json')
        coverage_text=(GENERATED/'v24-coverage.log').read_text(errors='replace') if (GENERATED/'v24-coverage.log').exists() else ''
        match=re.search(r'^# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)',coverage_text,re.M)
        checks={
          'allStagesAcceptable':not any(item['status'] in ('failed','timed-out') for item in stages),
          'completeSuite':tests.get('status')=='passed' and tests.get('totals',{}).get('tests',0)>=242 and tests.get('totals',{}).get('failed')==0 and tests.get('inventory',{}).get('missing')==[],
          'noTestReduction':tests.get('performance',{}).get('currentTestCount',0)>=tests.get('performance',{}).get('testCountMustNotDecrease',10**9),
          'mutationAuthentic':mutation.get('status')=='passed' and mutation.get('mutantsKilledAuthentically',0)>=18 and mutation.get('invalidKills')==0 and mutation.get('mutantsSurvived')==0,
          'qualityClean':quality.get('status')=='passed' and quality.get('criticalOrHighIssues')==0 and quality.get('mediumIssues')==0,
          'stability':stability.get('status')=='passed' and stability.get('flakeCount')==0,
          'localPerformanceImproved':perf.get('status')=='passed-local-only' and perf.get('fullSuite',{}).get('comparison',{}).get('status')=='improved',
          'isolationResearchProof':isolation.get('status')=='passed-single-host-research-proof',
          'operationsFailClosed':ops.get('status')=='passed' and ops.get('center',{}).get('overallState')=='blocked',
          'qualificationHonest':qualification.get('readiness')=='Integrated Pilot' and qualification.get('productionPromotion')=='blocked',
          'postgresExplicit':pg.get('status') in ('environment-blocked','implemented-and-exercised-single-database'),
          'impactOptimizationNonAuthoritative':impact.get('classification')=='developer-feedback-optimization-not-authoritative-release-validation',
          'noTaggedOrphans':not orphans,
        }
        status='passed' if all(checks.values()) else 'failed'
        report={
          'version':'24.0','ownerRole':'Independent Validation and Operational Efficiency Leads','status':status,'runId':RUN_ID,'startedAt':started_at,'finishedAt':utc(),
          'cleanState':{'priorGeneratedEvidenceQuarantined':quarantine is not None,'priorEvidencePath':str(quarantine.relative_to(ROOT)) if quarantine else None,'newGeneratedDirectoryCreated':True,'distCoverageAndCacheRemoved':True,'exclusiveLease':True,'leftoverTaggedProcesses':orphans},
          'stages':stages,'checks':checks,'tests':tests.get('totals',{}),'testInventory':tests.get('inventory',{}),
          'coverage':{'linePercent':float(match.group(1)) if match else None,'branchPercent':float(match.group(2)) if match else None,'functionPercent':float(match.group(3)) if match else None,'scope':'Node in-process coverage; external/process/isolation lanes are exercised in the complete suite'},
          'mutation':{key:mutation.get(key) for key in ('status','mutantsCreated','mutantsKilledAuthentically','mutantsSurvived','invalidKills','mutationScorePercent')},
          'stability':stability.get('statistics',{}),'performance':perf.get('fullSuite',{}),'testQuality':{key:quality.get(key) for key in ('status','filesAudited','testsDeclared','assertCalls','criticalOrHighIssues','mediumIssues')},
          'postgres':pg,'qualification':qualification,'operations':ops.get('center',{}),
          'acceptance':{'v24OperationalEfficiencyIntegratedPilot':'met' if status=='passed' else 'not-met','production':'not-met'},
          'provenance':['executed from canonical/proof-v24','all commands and combined stdout/stderr recorded','prior generated evidence quarantined before execution','complete test inventory enforced at runtime','mutation kills require behavior-specific failure markers','PostgreSQL blocking accepted only as an explicit environment status'],
          'limitations':['single-host local proof','PostgreSQL primary/standby unavailable unless target endpoints are supplied','no real KMS/HSM','untrusted-code isolation is not independently certified','no external penetration test','human pilot protocol not executed','source archives and legal review absent'],
          'confidence':'high for local reproducibility, test completeness, operational fail-closed behavior and measured local efficiency; low for production qualification','independentVerificationStatus':'self-contained adversarial validation, not external certification',
          'nextAction':'Run v25 external qualification against PostgreSQL primary/standby, authorized KMS/HSM, independently assessed isolation, and a consented human pilot.'
        }
        atomic_json(GENERATED/'V24_FINAL_VALIDATION.json',report); atomic_json(GENERATED/'V24_CLEAN_STATE_VALIDATION.json',report['cleanState']|{'version':'24.0','status':status,'runId':RUN_ID}); atomic_json(GENERATED/'V24_COMMAND_RECORD.json',{'version':'24.0','runId':RUN_ID,'commands':stages}); (GENERATED/'V24_VALIDATION_IN_PROGRESS.json').unlink(missing_ok=True); atomic_json(GENERATED/'V24_VALIDATION_COMPLETED.json',{'version':'24.0','runId':RUN_ID,'status':status,'finishedAt':utc()})
        print(json.dumps({'status':status,'tests':report['tests'],'coverage':report['coverage'],'mutation':report['mutation'],'stability':report['stability'],'performance':report['performance'],'postgresStatus':pg.get('status'),'orphans':orphans,'failedChecks':[key for key,value in checks.items() if not value]},indent=2))
        return 0 if status=='passed' else 1
    except KeyboardInterrupt:
        interrupted=True; cleanup_tagged_processes(); raise
    finally:
        try: LOCK.unlink()
        except FileNotFoundError: pass
        if interrupted and GENERATED.exists(): atomic_json(GENERATED/'V24_VALIDATION_INTERRUPTED.json',{'version':'24.0','runId':RUN_ID,'interruptedAt':utc()})

if __name__=='__main__': raise SystemExit(main())
