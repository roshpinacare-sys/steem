#!/usr/bin/env python3
from __future__ import annotations
import json, os, shutil, signal, subprocess, time, uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'evidence'; GENERATED=EVIDENCE/'generated'
RUN_ID=f'v27-{uuid.uuid4()}'
LOCK=EVIDENCE/'.validation-v27.lock'

def utc(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def atomic_json(path:Path,value):
    path.parent.mkdir(parents=True,exist_ok=True); temp=path.with_name(f'.{path.name}.{os.getpid()}.{uuid.uuid4()}.tmp')
    temp.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8')
    with temp.open('rb') as handle: os.fsync(handle.fileno())
    os.replace(temp,path)
def alive(pid:int)->bool:
    try: os.kill(pid,0); return True
    except (ProcessLookupError,PermissionError): return False
def acquire():
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    for _ in range(2):
        try:
            fd=os.open(LOCK,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            os.write(fd,(json.dumps({'pid':os.getpid(),'runId':RUN_ID,'createdAt':utc()})+'\n').encode()); os.fsync(fd); os.close(fd); return
        except FileExistsError:
            try: row=json.loads(LOCK.read_text())
            except Exception: row={}
            pid=row.get('pid') if isinstance(row.get('pid'),int) else -1
            if not alive(pid):
                stale=EVIDENCE/'quarantine'/f'stale-validation-lock-{int(time.time())}-{uuid.uuid4()}.json'; stale.parent.mkdir(parents=True,exist_ok=True); LOCK.rename(stale); continue
            raise RuntimeError(f'validation_already_running:{row}')
    raise RuntimeError('validation_lock_unrecoverable')
def cleanup_tagged():
    marker=f'V27_VALIDATION_RUN_ID={RUN_ID}'.encode(); tagged=[]
    proc=Path('/proc')
    if not proc.exists(): return tagged
    for entry in proc.iterdir():
        if not entry.name.isdigit() or int(entry.name)==os.getpid(): continue
        try:
            if marker in (entry/'environ').read_bytes().split(b'\0'):
                os.kill(int(entry.name),signal.SIGTERM); tagged.append(int(entry.name))
        except (FileNotFoundError,ProcessLookupError,PermissionError): pass
    time.sleep(.25)
    for pid in tagged:
        try: os.kill(pid,signal.SIGKILL)
        except (ProcessLookupError,PermissionError): pass
    return tagged
def stage(name,command,timeout,acceptable=(0,),classes=None):
    log=GENERATED/f'{name}.log'; started=utc(); clock=time.monotonic(); env={**os.environ,'V27_VALIDATION_RUN_ID':RUN_ID,'NODE_ENV':'test','NODE_OPTIONS':'','V27_TEST_WORKERS':'4','V27_TEST_CAPACITY':'5'}
    timed_out=False
    with log.open('w',encoding='utf-8') as stream:
        process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=stream,stderr=subprocess.STDOUT,text=True,start_new_session=True)
        try: process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out=True
            try: os.killpg(process.pid,signal.SIGTERM)
            except ProcessLookupError: pass
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try: os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError: pass
                process.wait(timeout=5)
    status='timed-out' if timed_out else ((classes or {}).get(process.returncode,'passed') if process.returncode in acceptable else 'failed')
    return {'name':name,'command':command,'startedAt':started,'durationMs':round((time.monotonic()-clock)*1000,3),'exitCode':process.returncode,'timedOut':timed_out,'status':status,'acceptableExitCodes':list(acceptable),'log':str(log.relative_to(ROOT))}
def load(name):
    try: return json.loads((GENERATED/name).read_text())
    except Exception: return {}

def main():
    acquire(); started=utc(); quarantine=None; records=[]; interrupted=False
    try:
        if GENERATED.exists():
            quarantine=EVIDENCE/'quarantine'/f'{int(time.time())}-{RUN_ID}'; quarantine.parent.mkdir(parents=True,exist_ok=True); GENERATED.rename(quarantine)
        GENERATED.mkdir(parents=True,exist_ok=False)
        atomic_json(GENERATED/'V27_VALIDATION_IN_PROGRESS.json',{'version':'27.0','runId':RUN_ID,'pid':os.getpid(),'startedAt':started,'quarantinedPriorEvidence':str(quarantine.relative_to(ROOT)) if quarantine else None})
        for path in (ROOT/'dist',ROOT/'coverage',ROOT/'.cache'):
            if path.exists(): shutil.rmtree(path)
        plan=[
          ('build',['npm','run','build:clean:v27'],180,(0,),None),
          ('prepare-isolation',['bash','scripts/prepare-linux-probes-v27.sh'],120,(0,),None),
          ('tests',['python3','scripts/run-tests-v27-parallel.py'],240,(0,),None),
          ('test-quality',['node','scripts/test-quality-audit-v27.mjs'],90,(0,),None),
          ('incomplete-code-audit',['node','scripts/incomplete-code-audit-v27.mjs'],90,(0,),None),
          ('coverage',['node','scripts/run-coverage-v27.mjs'],360,(0,),None),
          ('architecture',['node','scripts/architecture-validation-v27.mjs'],120,(0,),None),
          ('mutation',['python3','scripts/run-mutation-v27.py'],900,(0,),None),
          ('local-performance',['node','scripts/benchmark-v27.mjs'],120,(0,),None),
          ('design-closure',['node','scripts/design-closure-v27.mjs'],90,(0,),None),
          ('invariants',['node','scripts/invariant-coverage-v27.mjs'],90,(0,),None),
          ('supply-chain',['node','scripts/supply-chain-report-v27.mjs'],180,(0,),None),
          ('local-dr',['node','scripts/local-dr-rehearsal-v27.mjs'],120,(0,),None),
          ('pilot-protocol',['node','scripts/generate-human-pilot-v27.mjs'],90,(0,),None),
          ('environment',['node','scripts/probe-environment-v27.mjs'],90,(0,),None),
          ('postgres-qualification',['node','scripts/qualify-postgres-v27.mjs'],180,(0,2),{2:'environment-blocked'}),
          ('linux-isolation',['bash','scripts/run-linux-isolation-v27.sh'],180,(0,),None),
          ('browser-e2e',['python3','e2e/test_breakthrough_pilot_v27.py'],300,(0,),None),
          ('operations-report',['node','scripts/generate-operations-report-v27.mjs'],90,(0,),None),
          ('engineering-completeness',['node','scripts/system-completeness-v27.mjs'],90,(0,),None),
          ('stability',['python3','scripts/stability-v27.py'],600,(0,),None),
          ('qualification-matrix',['node','scripts/qualification-matrix-v27.mjs'],90,(0,),None),
        ]
        for item in plan:
            record=stage(*item); records.append(record); atomic_json(GENERATED/'V27_COMMAND_RECORD.partial.json',{'version':'27.0','runId':RUN_ID,'commands':records})
            if record['status'] in ('failed','timed-out'): break
        orphans=cleanup_tagged()
        tests=load('V27_TEST_RESULTS.json'); quality=load('V27_TEST_QUALITY_AUDIT.json'); incomplete=load('V27_INCOMPLETE_CODE_AUDIT.json'); coverage=load('V27_COVERAGE_REPORT.json'); architecture=load('V27_ARCHITECTURE_INTEGRITY.json'); mutation=load('V27_MUTATION_RESULTS.json'); perf=load('V27_LOCAL_PERFORMANCE.json'); design=load('V27_DESIGN_CLOSURE.json'); invariants=load('V27_INVARIANT_COVERAGE.json'); supply=load('V27_SUPPLY_CHAIN_REPORT.json'); dr=load('V27_LOCAL_DR_REHEARSAL.json'); pilot=load('V27_HUMAN_PILOT_PROTOCOL.json'); environment=load('V27_ENVIRONMENT_PROBE.json'); pg=load('V27_POSTGRES_QUALIFICATION.json'); isolation=load('V27_LINUX_ISOLATION.json'); browser=load('V27_BROWSER_E2E.json'); operations=load('V27_OPERATIONAL_ACTION_CENTER.json'); completeness=load('V27_ENGINEERING_COMPLETENESS.json'); stability=load('V27_STABILITY_REPORT.json'); qualification=load('V27_QUALIFICATION_MATRIX.json')
        totals=tests.get('totals',{}); inventory=tests.get('inventory',{}); current=coverage.get('current',{}); architecture_metrics=architecture.get('metrics',{}); runs=stability.get('runs',[])
        checks={
          'allStagesAcceptable':len(records)==len(plan) and not any(row['status'] in ('failed','timed-out') for row in records),
          'completeSuite':tests.get('status')=='passed' and totals.get('tests',0)>=381 and totals.get('tests')==totals.get('passed') and totals.get('failed')==0 and all(inventory.get(key)==[] for key in ('missing','extra','duplicates','compiledMissing')),
          'testQualityClean':quality.get('status')=='passed' and quality.get('filesAudited')==totals.get('testFiles') and quality.get('testsDeclared')==totals.get('tests') and quality.get('criticalOrHighIssues')==0 and quality.get('mediumIssues')==0,
          'incompleteCodeClosed':incomplete.get('status')=='passed' and not incomplete.get('explicitIncompleteMarkers') and not incomplete.get('packageScriptTargets',{}).get('missing') and not incomplete.get('criticalIntegrationGaps'),
          'coverageRaised':coverage.get('status')=='passed' and current.get('linePercent',0)>=99 and current.get('branchPercent',0)>=91 and current.get('functionPercent',0)>=98.5,
          'architectureClosed':architecture.get('status')=='PASS' and architecture_metrics.get('sourceCycleCount')==0 and architecture_metrics.get('untestedSourceCount')==0 and architecture_metrics.get('capabilityPathCount')==architecture_metrics.get('closedCapabilityPathCount') and architecture_metrics.get('closedCapabilityPathCount',0)>=8,
          'mutationAuthentic':mutation.get('status')=='passed' and mutation.get('mutantsSpecified',0)>=45 and mutation.get('mutantsCreated')==mutation.get('mutantsSpecified') and mutation.get('mutantsKilledAuthentically')==mutation.get('mutantsCreated') and mutation.get('invalidKills')==0 and mutation.get('mutantsSurvived')==0,
          'performanceBounded':perf.get('status')=='passed' and perf.get('efficiency',{}).get('avoidanceRate')==1,
          'designClosure':design.get('status')=='passed' and design.get('claims')==design.get('closed') and design.get('blocked')==0 and design.get('claims',0)>=6,
          'criticalInvariants':invariants.get('status')=='passed' and invariants.get('invariants')==invariants.get('fullyCovered') and invariants.get('invariants',0)>=14,
          'supplyChain':supply.get('status') in ('passed','passed-with-advisory-environment-blocked') and supply.get('archiveSelftest',{}).get('status')=='passed' and supply.get('dependencies',{}).get('status')=='passed' and supply.get('npmAudit',{}).get('status') in ('passed','environment-blocked') and (supply.get('npmAudit',{}).get('status')!='passed' or supply.get('npmAudit',{}).get('total')==0),
          'localRecovery':dr.get('status')=='passed-local-rehearsal',
          'humanClaimsBounded':pilot.get('status')=='protocol-ready-not-executed' and pilot.get('version')=='27.0',
          'postgresExplicit':pg.get('status') in ('environment-blocked','implemented-and-exercised-single-database'),
          'isolationResearchProof':isolation.get('status')=='passed-single-host-research-proof' and isolation.get('version')=='27.0',
          'browserWorkflow':browser.get('status')=='passed' and browser.get('health',{}).get('version')=='v27',
          'operationsFailClosed':operations.get('status')=='passed' and operations.get('center',{}).get('overallState')=='blocked' and operations.get('lifecycle',{}).get('verified') is True,
          'engineeringCompleteness':completeness.get('status')=='passed',
          'stability':stability.get('status')=='passed' and stability.get('flakeCount')==0 and len(runs)==3 and all(row.get('tests')==totals.get('tests') and row.get('failed')==0 for row in runs),
          'qualificationHonest':qualification.get('readiness')=='Integrated Pilot' and qualification.get('productionPromotion')=='blocked' and not qualification.get('hardFailures'),
          'governanceVersion':json.loads((ROOT/'governance-state/PROGRAM_STATE.json').read_text()).get('version')=='27.0',
          'noTaggedOrphans':not orphans,
        }
        status='passed' if all(checks.values()) else 'failed'
        report={'version':'27.0','ownerRole':'Independent High-Coverage Architecture, AI Governance and Release Validation Board','status':status,'runId':RUN_ID,'startedAt':started,'finishedAt':utc(),'cleanState':{'priorGeneratedEvidenceQuarantined':quarantine is not None,'priorEvidencePath':str(quarantine.relative_to(ROOT)) if quarantine else None,'distCoverageAndCacheRemoved':True,'exclusiveLease':True,'leftoverTaggedProcesses':orphans},'stages':records,'checks':checks,'tests':totals,'testInventory':inventory,'coverage':current,'architecture':architecture_metrics,'mutation':{key:mutation.get(key) for key in ('status','mutantsSpecified','mutantsCreated','mutantsKilledAuthentically','mutantsSurvived','invalidKills','mutationScorePercent','resumedAuthenticKills')},'designClosure':{key:design.get(key) for key in ('status','claims','closed','blocked','coveragePercent')},'invariantCoverage':{key:invariants.get(key) for key in ('status','invariants','fullyCovered','coveragePercent')},'performance':perf,'engineeringCompleteness':completeness,'postgres':pg,'qualification':qualification,'acceptance':{'v27HighCoverageGovernedAssistantIntegratedPilot':'met' if status=='passed' else 'not-met','production':'not-met'},'limitations':['single-host local proof','fixture model adapter without network inference','PostgreSQL primary/standby unavailable','no real KMS/HSM','isolation not independently certified','no external penetration or legal review','human pilot not executed','local performance is not a production SLO'],'confidence':'high for repository-local coverage, architecture closure, proposal-only model governance and selected adversarial controls; low for external production qualification','independentVerificationStatus':'role-separated self-contained adversarial validation, not external certification','nextAction':'Package and fresh-extract this exact v27 proof; then pursue external qualification only.'}
        atomic_json(GENERATED/'V27_FINAL_VALIDATION.json',report); atomic_json(GENERATED/'V27_CLEAN_STATE_VALIDATION.json',{'version':'27.0','status':status,'runId':RUN_ID,**report['cleanState']}); atomic_json(GENERATED/'V27_COMMAND_RECORD.json',{'version':'27.0','runId':RUN_ID,'commands':records}); (GENERATED/'V27_COMMAND_RECORD.partial.json').unlink(missing_ok=True); (GENERATED/'V27_VALIDATION_IN_PROGRESS.json').unlink(missing_ok=True); atomic_json(GENERATED/'V27_VALIDATION_COMPLETED.json',{'version':'27.0','runId':RUN_ID,'status':status,'finishedAt':utc()})
        print(json.dumps({'status':status,'tests':totals,'coverage':current,'architecture':architecture_metrics,'mutation':report['mutation'],'design':report['designClosure'],'invariants':report['invariantCoverage'],'failedChecks':[key for key,value in checks.items() if not value]},indent=2))
        return 0 if status=='passed' else 1
    except KeyboardInterrupt:
        interrupted=True; cleanup_tagged(); raise
    finally:
        LOCK.unlink(missing_ok=True)
        if interrupted and GENERATED.exists(): atomic_json(GENERATED/'V27_VALIDATION_INTERRUPTED.json',{'version':'27.0','runId':RUN_ID,'interruptedAt':utc()})
if __name__=='__main__': raise SystemExit(main())
