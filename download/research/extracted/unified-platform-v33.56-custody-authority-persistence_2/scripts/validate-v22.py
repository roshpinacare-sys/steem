#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, shutil, signal, subprocess, sys, time, uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'evidence'
GENERATED = EVIDENCE / 'generated'
LOCK = EVIDENCE / '.validation-v22.lock'
RUN_ID = f'v22-{uuid.uuid4()}'

def utc() -> str: return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, path)

def pid_alive(pid: int) -> bool:
    try: os.kill(pid, 0); return True
    except (ProcessLookupError, PermissionError): return False

def acquire_lock() -> None:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(fd, (json.dumps({'pid': os.getpid(), 'runId': RUN_ID, 'createdAt': utc()}) + '\n').encode())
            os.fsync(fd); os.close(fd); return
        except FileExistsError:
            try: current = json.loads(LOCK.read_text())
            except Exception: current = {}
            pid = current.get('pid') if isinstance(current.get('pid'), int) else -1
            if not pid_alive(pid):
                LOCK.rename(LOCK.with_name(f'.validation-v22.stale-{int(time.time())}-{uuid.uuid4()}'))
                continue
            raise RuntimeError(f'validation_already_running:{current}')
    raise RuntimeError('validation_lock_unrecoverable')

def cleanup_tagged_processes() -> list[int]:
    killed=[]
    proc=Path('/proc')
    if not proc.exists(): return killed
    marker=f'V22_VALIDATION_RUN_ID={RUN_ID}'.encode()
    for entry in proc.iterdir():
        if not entry.name.isdigit() or int(entry.name)==os.getpid(): continue
        try:
            if marker in (entry/'environ').read_bytes().split(b'\0'):
                os.kill(int(entry.name), signal.SIGTERM); killed.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError): pass
    time.sleep(.15)
    for pid in killed:
        try: os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError): pass
    return killed

def run_stage(name: str, command: list[str], timeout: int, acceptable=(0,), stdout_file: str|None=None) -> dict:
    started=time.monotonic(); log=GENERATED/f'{name}.log'; env={**os.environ,'V22_VALIDATION_RUN_ID':RUN_ID,'NODE_ENV':'test','NODE_OPTIONS':''}
    process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
    timed_out=False
    try:
        output,_=process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out=True
        os.killpg(process.pid, signal.SIGTERM)
        try: output,_=process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL); output,_=process.communicate()
    duration=round((time.monotonic()-started)*1000,3)
    log.write_text(output or '',encoding='utf-8')
    if stdout_file is not None and process.returncode in acceptable and not timed_out:
        (GENERATED/stdout_file).write_text(output or '',encoding='utf-8')
    status='passed' if process.returncode in acceptable and not timed_out else ('timed-out' if timed_out else 'failed')
    return {'name':name,'command':command,'startedAt':utc(),'durationMs':duration,'exitCode':process.returncode,'timedOut':timed_out,'status':status,'acceptableExitCodes':list(acceptable),'log':str(log.relative_to(ROOT))}

def copy_if(source: str, target: str) -> None:
    src=GENERATED/source
    if src.exists(): shutil.copy2(src, GENERATED/target)

def main() -> int:
    acquire_lock(); started_at=utc(); quarantine=None; stages=[]; interrupted=False
    try:
        if GENERATED.exists():
            quarantine=EVIDENCE/'quarantine'/f'{int(time.time())}-{RUN_ID}'
            quarantine.parent.mkdir(parents=True,exist_ok=True); GENERATED.rename(quarantine)
        GENERATED.mkdir(parents=True,exist_ok=False)
        atomic_json(GENERATED/'V22_VALIDATION_IN_PROGRESS.json', {'version':'22.0','runId':RUN_ID,'pid':os.getpid(),'startedAt':started_at,'quarantinedPriorEvidence':str(quarantine.relative_to(ROOT)) if quarantine else None})
        for path in [ROOT/'dist',ROOT/'coverage']:
            if path.exists(): shutil.rmtree(path)
        specs=[
          ('build',['npm','run','build'],60,(0,),None),
          ('tests',['python3','scripts/run-tests-v22-batches.py'],180,(0,),None),
          ('coverage',['node','scripts/run-coverage-v22.mjs'],210,(0,),None),
          ('integrated-demo',['node','dist/src/cli/demo-v22.js'],90,(0,),'v22-integrated-demo.json'),
          ('environment',['node','scripts/probe-environment-v22.mjs'],45,(0,),None),
          ('private-server-config',['node','scripts/validate-private-server-config.mjs'],45,(0,),'private-server-config-v22.json'),
          ('postgres-qualification',['node','scripts/qualify-postgres-v22.mjs'],60,(0,2),None),
          ('browser-e2e',['python3','e2e/test_breakthrough_pilot_v22.py'],120,(0,),None),
          ('efficiency',['node','scripts/benchmark-v22.mjs'],90,(0,),None),
          ('mutation',['python3','scripts/run-mutation-v22.py'],150,(0,),None),
          ('npm-audit',['npm','audit','--json'],20,(0,1), 'npm-audit-v22.raw.json'),
        ]
        for spec in specs:
            record=run_stage(*spec); stages.append(record)
            if record['status']!='passed' and record['name'] not in ('npm-audit','postgres-qualification'): break
        orphans=cleanup_tagged_processes()
        test_data=json.loads((GENERATED/'V22_TEST_RESULTS.json').read_text()) if (GENERATED/'V22_TEST_RESULTS.json').exists() else {}
        mutation=json.loads((GENERATED/'V22_MUTATION_RESULTS.json').read_text()) if (GENERATED/'V22_MUTATION_RESULTS.json').exists() else {}
        coverage_text=(GENERATED/'v22-coverage.log').read_text(errors='replace') if (GENERATED/'v22-coverage.log').exists() else ''
        m=re.search(r'^# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)',coverage_text,re.M)
        required=[s for s in stages if s['name'] not in ('npm-audit','postgres-qualification')]
        status='passed' if len(required)==9 and all(s['status']=='passed' for s in required) and not orphans else 'failed'
        report={'version':'22.0','ownerRole':'Independent Validation Lead','status':status,'runId':RUN_ID,'startedAt':started_at,'finishedAt':utc(),'cleanState':{'priorGeneratedEvidenceQuarantined':quarantine is not None,'priorEvidencePath':str(quarantine.relative_to(ROOT)) if quarantine else None,'newGeneratedDirectoryCreated':True,'exclusiveLease':True,'leftoverTaggedProcesses':orphans},'stages':stages,'tests':test_data.get('totals',{}),'coverage':{'linePercent':float(m.group(1)) if m else None,'branchPercent':float(m.group(2)) if m else None,'functionPercent':float(m.group(3)) if m else None},'mutation':mutation,'acceptance':{'minimum':'met' if status=='passed' else 'not-met','strong':'partially-met','production':'not-met'},'provenance':['executed from canonical/proof-v22','commands recorded with stdout/stderr logs','prior generated evidence quarantined before execution'],'evidence':['V22_TEST_RESULTS.json','v22-coverage.log','V22_MUTATION_RESULTS.json','v22-browser-e2e.json'],'assumptions':['Local filesystem rename and fsync semantics are available.'],'limitations':['Single-host local proof','PostgreSQL may be environment-blocked','No real KMS/HSM','No qualified untrusted-code isolation','No external penetration test','No human pilot','Source archives are absent from this delivery.'],'confidence':'high for local reproducibility; low for production qualification','independentVerificationStatus':'self-contained adversarial validation, not external certification','nextAction':'Run v23 on qualified durable/isolation infrastructure and with human users.'}
        atomic_json(GENERATED/'V22_FINAL_VALIDATION.json',report)
        atomic_json(GENERATED/'V22_CLEAN_STATE_VALIDATION.json',report['cleanState']|{'version':'22.0','status':status,'runId':RUN_ID})
        atomic_json(GENERATED/'V22_COMMAND_RECORD.json',{'version':'22.0','runId':RUN_ID,'commands':stages})
        (GENERATED/'V22_VALIDATION_IN_PROGRESS.json').unlink(missing_ok=True)
        atomic_json(GENERATED/'V22_VALIDATION_COMPLETED.json',{'version':'22.0','runId':RUN_ID,'status':status,'finishedAt':utc()})
        print(json.dumps({'status':status,'tests':report['tests'],'coverage':report['coverage'],'mutation':report['mutation'].get('summary',report['mutation']),'orphans':orphans},indent=2))
        return 0 if status=='passed' else 1
    except KeyboardInterrupt:
        interrupted=True; cleanup_tagged_processes(); raise
    finally:
        try: LOCK.unlink()
        except FileNotFoundError: pass
        if interrupted and GENERATED.exists(): atomic_json(GENERATED/'V22_VALIDATION_INTERRUPTED.json',{'version':'22.0','runId':RUN_ID,'interruptedAt':utc()})

if __name__=='__main__': raise SystemExit(main())
