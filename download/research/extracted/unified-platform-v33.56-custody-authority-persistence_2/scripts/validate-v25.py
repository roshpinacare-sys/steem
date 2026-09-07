#!/usr/bin/env python3
from __future__ import annotations

import json, os, re, shutil, signal, subprocess, time, uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'evidence'; GENERATED=EVIDENCE/'generated'; LOCK=EVIDENCE/'.validation-v25.lock'
RUN_ID=f'v25-{uuid.uuid4()}'

def utc()->str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def atomic_json(path:Path,value:object)->None:
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(f'.{path.name}.{os.getpid()}.{uuid.uuid4()}.tmp')
    tmp.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8')
    with tmp.open('rb') as handle: os.fsync(handle.fileno())
    os.replace(tmp,path)

def pid_alive(pid:int)->bool:
    try: os.kill(pid,0); return True
    except (ProcessLookupError,PermissionError): return False

def acquire_lock()->None:
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    for _ in range(2):
        try:
            fd=os.open(LOCK,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            os.write(fd,(json.dumps({'pid':os.getpid(),'runId':RUN_ID,'createdAt':utc()})+'\n').encode())
            os.fsync(fd); os.close(fd); return
        except FileExistsError:
            try: current=json.loads(LOCK.read_text())
            except Exception: current={}
            pid=current.get('pid') if isinstance(current.get('pid'),int) else -1
            if not pid_alive(pid):
                LOCK.rename(LOCK.with_name(f'.validation-v25.stale-{int(time.time())}-{uuid.uuid4()}'))
                continue
            raise RuntimeError(f'validation_already_running:{current}')
    raise RuntimeError('validation_lock_unrecoverable')

def cleanup_tagged_processes()->list[int]:
    killed=[]; proc=Path('/proc'); marker=f'V25_VALIDATION_RUN_ID={RUN_ID}'.encode()
    if not proc.exists(): return killed
    for entry in proc.iterdir():
        if not entry.name.isdigit() or int(entry.name)==os.getpid(): continue
        try:
            values=(entry/'environ').read_bytes().split(b'\0')
            if marker in values:
                os.kill(int(entry.name),signal.SIGTERM); killed.append(int(entry.name))
        except (FileNotFoundError,ProcessLookupError,PermissionError): pass
    time.sleep(.25)
    for pid in killed:
        try: os.kill(pid,signal.SIGKILL)
        except (ProcessLookupError,PermissionError): pass
    return killed

def run_stage(name:str,command:list[str],timeout:int,acceptable:tuple[int,...]=(0,),classification_by_code:dict[int,str]|None=None)->dict:
    started_at=utc(); started=time.monotonic(); log=GENERATED/f'{name}.log'; timed_out=False
    env={**os.environ,'V25_VALIDATION_RUN_ID':RUN_ID,'NODE_ENV':'test','NODE_OPTIONS':''}
    with log.open('w',encoding='utf-8') as stream:
        process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=stream,stderr=subprocess.STDOUT,text=True,start_new_session=True)
        try: process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out=True
            try: os.killpg(process.pid,signal.SIGTERM)
            except ProcessLookupError: pass
            try: process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                try: os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError: pass
                process.wait(timeout=4)
    duration=round((time.monotonic()-started)*1000,3)
    if timed_out: status='timed-out'
    elif process.returncode in acceptable: status=(classification_by_code or {}).get(process.returncode,'passed')
    else: status='failed'
    return {'name':name,'command':command,'startedAt':started_at,'durationMs':duration,'exitCode':process.returncode,'timedOut':timed_out,'status':status,'acceptableExitCodes':list(acceptable),'log':str(log.relative_to(ROOT))}

def load(name:str)->dict:
    try: return json.loads((GENERATED/name).read_text())
    except Exception: return {}

def main()->int:
    acquire_lock(); started_at=utc(); quarantine=None; stages=[]; interrupted=False
    try:
        if GENERATED.exists():
            quarantine=EVIDENCE/'quarantine'/f'{int(time.time())}-{RUN_ID}'
            quarantine.parent.mkdir(parents=True,exist_ok=True); GENERATED.rename(quarantine)
        GENERATED.mkdir(parents=True,exist_ok=False)
        atomic_json(GENERATED/'V25_VALIDATION_IN_PROGRESS.json',{'version':'25.0','runId':RUN_ID,'pid':os.getpid(),'startedAt':started_at,'quarantinedPriorEvidence':str(quarantine.relative_to(ROOT)) if quarantine else None})
        for path in [ROOT/'dist',ROOT/'coverage',ROOT/'.cache']:
            if path.exists(): shutil.rmtree(path)
        plan=[
          ('build',['npm','run','build:clean:v25'],90,(0,),None),
          ('prepare-isolation',['bash','scripts/prepare-linux-probes-v25.sh'],90,(0,),None),
          ('tests',['python3','scripts/run-tests-v25-parallel.py'],120,(0,),None),
          ('test-quality',['node','scripts/test-quality-audit-v25.mjs'],45,(0,),None),
          ('coverage',['node','scripts/run-coverage-v25.mjs'],220,(0,),None),
          ('mutation',['python3','scripts/run-mutation-v25.py'],240,(0,),None),
          ('supply-chain',['node','scripts/supply-chain-report-v25.mjs'],90,(0,),None),
          ('invariants',['node','scripts/invariant-coverage-v25.mjs'],45,(0,),None),
          ('local-dr',['node','scripts/local-dr-rehearsal-v25.mjs'],60,(0,),None),
          ('pilot-protocol',['node','scripts/generate-human-pilot-v25.mjs'],30,(0,),None),
          ('environment',['node','scripts/probe-environment-v25.mjs'],45,(0,),None),
          ('postgres-qualification',['node','scripts/qualify-postgres-v25.mjs'],120,(0,2),{2:'environment-blocked'}),
          ('linux-isolation',['bash','scripts/run-linux-isolation-v25.sh'],90,(0,),None),
          ('browser-e2e',['python3','e2e/test_breakthrough_pilot_v25.py'],150,(0,),None),
          ('local-performance',['node','scripts/benchmark-v25.mjs'],90,(0,),None),
          ('operations-report',['node','scripts/generate-operations-report-v25.mjs'],45,(0,),None),
          ('stability',['python3','scripts/stability-v25.py'],330,(0,),None),
          ('qualification-matrix',['node','scripts/qualification-matrix-v25.mjs'],45,(0,),None),
        ]
        for name,command,timeout,acceptable,classifications in plan:
            record=run_stage(name,command,timeout,acceptable,classifications); stages.append(record)
            atomic_json(GENERATED/'V25_COMMAND_RECORD.partial.json',{'version':'25.0','runId':RUN_ID,'commands':stages})
            if record['status'] in ('failed','timed-out'): break
        orphans=cleanup_tagged_processes()
        tests=load('V25_TEST_RESULTS.json'); mutation=load('V25_MUTATION_RESULTS.json'); quality=load('V25_TEST_QUALITY_AUDIT.json'); stability=load('V25_STABILITY_REPORT.json'); pg=load('V25_POSTGRES_QUALIFICATION.json'); perf=load('V25_LOCAL_PERFORMANCE.json'); qualification=load('V25_QUALIFICATION_MATRIX.json'); isolation=load('V25_LINUX_ISOLATION.json'); ops=load('V25_OPERATIONAL_ACTION_CENTER.json'); supply=load('V25_SUPPLY_CHAIN_REPORT.json'); invariants=load('V25_INVARIANT_COVERAGE.json'); dr=load('V25_LOCAL_DR_REHEARSAL.json'); browser=load('V25_BROWSER_E2E.json'); pilot=load('V25_HUMAN_PILOT_PROTOCOL.json')
        coverage_text=(GENERATED/'v25-coverage.log').read_text(errors='replace') if (GENERATED/'v25-coverage.log').exists() else ''
        match=re.search(r'^# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)',coverage_text,re.M)
        totals=tests.get('totals',{}); inventory=tests.get('inventory',{})
        checks={
          'allStagesAcceptable':not any(item['status'] in ('failed','timed-out') for item in stages) and len(stages)==len(plan),
          'completeSuite':tests.get('status')=='passed' and totals.get('tests')==288 and totals.get('passed')==288 and totals.get('failed')==0 and totals.get('testFiles')==58 and inventory.get('missing')==[] and inventory.get('extra')==[] and inventory.get('duplicates')==[] and inventory.get('compiledMissing')==[],
          'noTestReduction':tests.get('performance',{}).get('currentTestCount',0)>=tests.get('performance',{}).get('testCountMustNotDecrease',10**9),
          'mutationAuthentic':mutation.get('status')=='passed' and mutation.get('mutantsCreated')==27 and mutation.get('mutantsKilledAuthentically')==27 and mutation.get('invalidKills')==0 and mutation.get('mutantsSurvived')==0,
          'qualityClean':quality.get('status')=='passed' and quality.get('filesAudited')==58 and quality.get('testsDeclared')==288 and quality.get('criticalOrHighIssues')==0 and quality.get('mediumIssues')==0,
          'coverageMeasured':bool(match) and float(match.group(1))>=96 and float(match.group(2))>=83 and float(match.group(3))>=97,
          'stability':stability.get('status')=='passed' and stability.get('flakeCount')==0 and len(stability.get('runs',[]))==3 and all(r.get('tests')==288 and r.get('failed')==0 for r in stability.get('runs',[])),
          'localPerformanceImproved':perf.get('status')=='passed-local-only' and perf.get('fullSuite',{}).get('comparison',{}).get('status')=='improved',
          'supplyChain':supply.get('status')=='passed' and supply.get('npmAudit',{}).get('total')==0 and supply.get('archiveSelftest',{}).get('status')=='passed',
          'criticalInvariants':invariants.get('status')=='passed' and invariants.get('invariants')==7 and invariants.get('fullyCovered')==7 and invariants.get('coveragePercent')==100,
          'localRecovery':dr.get('status')=='passed-local-rehearsal',
          'browserWorkflow':browser.get('status')=='passed' and browser.get('health',{}).get('version')=='v25',
          'isolationResearchProof':isolation.get('status')=='passed-single-host-research-proof',
          'operationsFailClosed':ops.get('status')=='passed' and ops.get('center',{}).get('overallState')=='blocked' and ops.get('lifecycle',{}).get('verified') is True,
          'humanClaimsBounded':pilot.get('status')=='protocol-ready-not-executed',
          'qualificationHonest':qualification.get('readiness')=='Integrated Pilot' and qualification.get('productionPromotion')=='blocked' and not qualification.get('hardFailures'),
          'postgresExplicit':pg.get('status') in ('environment-blocked','implemented-and-exercised-single-database'),
          'governanceVersion':json.loads((ROOT/'governance-state/PROGRAM_STATE.json').read_text()).get('version')=='25.0',
          'noTaggedOrphans':not orphans,
        }
        status='passed' if all(checks.values()) else 'failed'
        report={
          'version':'25.0','ownerRole':'Independent Validation, Cryptographic Integrity, Operations and Portability Leads','status':status,'runId':RUN_ID,'startedAt':started_at,'finishedAt':utc(),
          'cleanState':{'priorGeneratedEvidenceQuarantined':quarantine is not None,'priorEvidencePath':str(quarantine.relative_to(ROOT)) if quarantine else None,'newGeneratedDirectoryCreated':True,'distCoverageAndCacheRemoved':True,'exclusiveLease':True,'leftoverTaggedProcesses':orphans},
          'stages':stages,'checks':checks,'tests':totals,'testInventory':inventory,
          'coverage':{'linePercent':float(match.group(1)) if match else None,'branchPercent':float(match.group(2)) if match else None,'functionPercent':float(match.group(3)) if match else None,'scope':'Node in-process coverage; external process, browser, namespace, WebAssembly worker, replay multiprocessing, repository execution and archive lanes are exercised in the authoritative suite.'},
          'mutation':{key:mutation.get(key) for key in ('status','mutantsCreated','mutantsKilledAuthentically','mutantsSurvived','invalidKills','mutationScorePercent')},
          'stability':stability.get('statistics',{}),'performance':perf.get('fullSuite',{}),'testQuality':{key:quality.get(key) for key in ('status','filesAudited','testsDeclared','assertCalls','criticalOrHighIssues','mediumIssues')},
          'supplyChain':{'status':supply.get('status'),'packages':supply.get('dependencies',{}).get('packages'),'npmVulnerabilities':supply.get('npmAudit',{}).get('total'),'archiveSelftest':supply.get('archiveSelftest',{}).get('status')},
          'invariantCoverage':{'total':invariants.get('invariants'),'critical':invariants.get('critical'),'fullyCovered':invariants.get('fullyCovered'),'coveragePercent':invariants.get('coveragePercent'),'findings':invariants.get('findings')},'postgres':pg,'qualification':qualification,'operations':ops.get('center',{}),
          'acceptance':{'v25DeepIntegrityIntegratedPilot':'met' if status=='passed' else 'not-met','production':'not-met'},
          'provenance':['executed from canonical/proof-v25','all commands and combined stdout/stderr recorded','prior generated evidence quarantined before execution','source/scheduled/compiled test inventory enforced','mutation kills require behavior-specific failure markers','archive and dependency policy exercised','PostgreSQL blocking accepted only as explicit environment status'],
          'limitations':['single-host local proof','file replay is not multi-host consensus','PostgreSQL primary/standby unavailable unless target endpoints are supplied','no real KMS/HSM','untrusted-code isolation not independently certified','no external penetration test','human pilot protocol not executed','source archives and legal review absent','local benchmarks are not production SLOs'],
          'confidence':'high for local cryptographic input integrity, replay persistence, test authenticity, portability, bounded operations and reproducibility; low for production qualification',
          'independentVerificationStatus':'self-contained role-separated adversarial validation, not external certification',
          'nextAction':'Run v26 external qualification against PostgreSQL primary/standby, authorized KMS/HSM, independently assessed isolation, external security/legal review and a consented human pilot.'
        }
        atomic_json(GENERATED/'V25_FINAL_VALIDATION.json',report)
        atomic_json(GENERATED/'V25_CLEAN_STATE_VALIDATION.json',report['cleanState']|{'version':'25.0','status':status,'runId':RUN_ID})
        atomic_json(GENERATED/'V25_COMMAND_RECORD.json',{'version':'25.0','runId':RUN_ID,'commands':stages})
        (GENERATED/'V25_COMMAND_RECORD.partial.json').unlink(missing_ok=True)
        (GENERATED/'V25_VALIDATION_IN_PROGRESS.json').unlink(missing_ok=True)
        atomic_json(GENERATED/'V25_VALIDATION_COMPLETED.json',{'version':'25.0','runId':RUN_ID,'status':status,'finishedAt':utc()})
        print(json.dumps({'status':status,'tests':totals,'coverage':report['coverage'],'mutation':report['mutation'],'stability':report['stability'],'performance':report['performance'],'postgresStatus':pg.get('status'),'orphans':orphans,'failedChecks':[key for key,value in checks.items() if not value]},indent=2))
        return 0 if status=='passed' else 1
    except KeyboardInterrupt:
        interrupted=True; cleanup_tagged_processes(); raise
    finally:
        try: LOCK.unlink()
        except FileNotFoundError: pass
        if interrupted and GENERATED.exists(): atomic_json(GENERATED/'V25_VALIDATION_INTERRUPTED.json',{'version':'25.0','runId':RUN_ID,'interruptedAt':utc()})

if __name__=='__main__': raise SystemExit(main())
