#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, shutil, signal, subprocess, time, uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'evidence'
GENERATED = EVIDENCE / 'generated'
LOCK = EVIDENCE / '.validation-v23.lock'
RUN_ID = f'v23-{uuid.uuid4()}'


def utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, path)


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def acquire_lock() -> None:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(fd, (json.dumps({'pid': os.getpid(), 'runId': RUN_ID, 'createdAt': utc()}) + '\n').encode())
            os.fsync(fd)
            os.close(fd)
            return
        except FileExistsError:
            try:
                current = json.loads(LOCK.read_text())
            except Exception:
                current = {}
            pid = current.get('pid') if isinstance(current.get('pid'), int) else -1
            if not pid_alive(pid):
                LOCK.rename(LOCK.with_name(f'.validation-v23.stale-{int(time.time())}-{uuid.uuid4()}'))
                continue
            raise RuntimeError(f'validation_already_running:{current}')
    raise RuntimeError('validation_lock_unrecoverable')


def cleanup_tagged_processes() -> list[int]:
    killed=[]
    proc=Path('/proc')
    if not proc.exists(): return killed
    marker=f'V23_VALIDATION_RUN_ID={RUN_ID}'.encode()
    for entry in proc.iterdir():
        if not entry.name.isdigit() or int(entry.name)==os.getpid(): continue
        try:
            if marker in (entry/'environ').read_bytes().split(b'\0'):
                os.kill(int(entry.name), signal.SIGTERM); killed.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError): pass
    time.sleep(.2)
    for pid in killed:
        try: os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError): pass
    return killed


def run_stage(name: str, command: list[str], timeout: int, acceptable=(0,), stdout_file: str|None=None) -> dict:
    started_at=utc(); started=time.monotonic(); log=GENERATED/f'{name}.log'
    env={**os.environ,'V23_VALIDATION_RUN_ID':RUN_ID,'NODE_ENV':'test','NODE_OPTIONS':''}
    process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
    timed_out=False
    try:
        output,_=process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out=True
        os.killpg(process.pid, signal.SIGTERM)
        try: output,_=process.communicate(timeout=4)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL); output,_=process.communicate()
    duration=round((time.monotonic()-started)*1000,3)
    log.write_text(output or '',encoding='utf-8')
    if stdout_file is not None and process.returncode in acceptable and not timed_out:
        (GENERATED/stdout_file).write_text(output or '',encoding='utf-8')
    status='passed' if process.returncode in acceptable and not timed_out else ('timed-out' if timed_out else 'failed')
    return {'name':name,'command':command,'startedAt':started_at,'durationMs':duration,'exitCode':process.returncode,'timedOut':timed_out,'status':status,'acceptableExitCodes':list(acceptable),'log':str(log.relative_to(ROOT))}


def main() -> int:
    acquire_lock(); started_at=utc(); quarantine=None; stages=[]; interrupted=False
    try:
        if GENERATED.exists():
            quarantine=EVIDENCE/'quarantine'/f'{int(time.time())}-{RUN_ID}'
            quarantine.parent.mkdir(parents=True,exist_ok=True); GENERATED.rename(quarantine)
        GENERATED.mkdir(parents=True,exist_ok=False)
        atomic_json(GENERATED/'V23_VALIDATION_IN_PROGRESS.json', {'version':'23.0','runId':RUN_ID,'pid':os.getpid(),'startedAt':started_at,'quarantinedPriorEvidence':str(quarantine.relative_to(ROOT)) if quarantine else None})
        for path in [ROOT/'dist',ROOT/'coverage']:
            if path.exists(): shutil.rmtree(path)
        specs=[
          ('build',['npm','run','build'],75,(0,),None),
          ('tests',['python3','scripts/run-tests-v23-batches.py'],210,(0,),None),
          ('coverage',['node','scripts/run-coverage-v23.mjs'],240,(0,),None),
          ('environment',['node','scripts/probe-environment-v23.mjs'],45,(0,),None),
          ('postgres-qualification',['node','scripts/qualify-postgres-v23.mjs'],110,(0,2),None),
          ('linux-isolation',['bash','scripts/run-linux-isolation-v23.sh'],75,(0,),None),
          ('browser-e2e',['python3','e2e/test_breakthrough_pilot_v23.py'],150,(0,),None),
          ('pilot-protocol',['node','scripts/generate-human-pilot-v23.mjs'],45,(0,),None),
          ('local-slo',['node','scripts/benchmark-v23.mjs'],120,(0,),None),
          ('local-dr',['node','scripts/local-dr-rehearsal-v23.mjs'],60,(0,),None),
          ('qualification-matrix',['node','scripts/qualification-matrix-v23.mjs'],75,(0,),None),
          ('mutation',['python3','scripts/run-mutation-v23.py'],180,(0,),None),
          ('test-quality',['python3','scripts/test-quality-audit-v23.py'],60,(0,),None),
          ('npm-audit',['npm','audit','--json'],30,(0,1),'npm-audit-v23.raw.json'),
        ]
        optional={'postgres-qualification','npm-audit'}
        for spec in specs:
            record=run_stage(*spec); stages.append(record)
            if record['status']!='passed' and record['name'] not in optional: break
        orphans=cleanup_tagged_processes()
        test_data=json.loads((GENERATED/'V23_TEST_RESULTS.json').read_text()) if (GENERATED/'V23_TEST_RESULTS.json').exists() else {}
        mutation=json.loads((GENERATED/'V23_MUTATION_RESULTS.json').read_text()) if (GENERATED/'V23_MUTATION_RESULTS.json').exists() else {}
        quality=json.loads((GENERATED/'V23_TEST_QUALITY_AUDIT.json').read_text()) if (GENERATED/'V23_TEST_QUALITY_AUDIT.json').exists() else {}
        pg=json.loads((GENERATED/'V23_POSTGRES_QUALIFICATION.json').read_text()) if (GENERATED/'V23_POSTGRES_QUALIFICATION.json').exists() else {}
        coverage_text=(GENERATED/'v23-coverage.log').read_text(errors='replace') if (GENERATED/'v23-coverage.log').exists() else ''
        m=re.search(r'^# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)',coverage_text,re.M)
        required=[s for s in stages if s['name'] not in optional]
        expected_required=12
        status='passed' if len(required)==expected_required and all(s['status']=='passed' for s in required) and not orphans else 'failed'
        report={
          'version':'23.0','ownerRole':'Independent Validation Lead','status':status,'runId':RUN_ID,'startedAt':started_at,'finishedAt':utc(),
          'cleanState':{'priorGeneratedEvidenceQuarantined':quarantine is not None,'priorEvidencePath':str(quarantine.relative_to(ROOT)) if quarantine else None,'newGeneratedDirectoryCreated':True,'exclusiveLease':True,'leftoverTaggedProcesses':orphans},
          'stages':stages,'tests':test_data.get('totals',{}),
          'coverage':{'linePercent':float(m.group(1)) if m else None,'branchPercent':float(m.group(2)) if m else None,'functionPercent':float(m.group(3)) if m else None},
          'mutation':mutation.get('summary',mutation),'testQuality':quality.get('summary',quality),'postgres':pg,
          'acceptance':{'v23QualifiedIntegratedPilot':'met' if status=='passed' else 'not-met','production':'not-met'},
          'provenance':['executed from canonical/proof-v23','all stage commands and combined stdout/stderr recorded','prior generated evidence quarantined before execution','PostgreSQL environment blocking accepted only as an explicit qualification status'],
          'limitations':['single-host local proof','PostgreSQL live server unavailable unless V23_POSTGRES_URL supplied','no real KMS/HSM','untrusted-code isolation is not independently certified','no external penetration test','human pilot protocol not executed','source archives and legal review absent'],
          'confidence':'high for local reproducibility and tested contracts; low for production qualification','independentVerificationStatus':'self-contained adversarial validation, not external certification',
          'nextAction':'Run v24 qualification on dedicated PostgreSQL primary/standby, authorized KMS/HSM, independently reviewed isolation, and consented human pilot.'
        }
        atomic_json(GENERATED/'V23_FINAL_VALIDATION.json',report)
        atomic_json(GENERATED/'V23_CLEAN_STATE_VALIDATION.json',report['cleanState']|{'version':'23.0','status':status,'runId':RUN_ID})
        atomic_json(GENERATED/'V23_COMMAND_RECORD.json',{'version':'23.0','runId':RUN_ID,'commands':stages})
        (GENERATED/'V23_VALIDATION_IN_PROGRESS.json').unlink(missing_ok=True)
        atomic_json(GENERATED/'V23_VALIDATION_COMPLETED.json',{'version':'23.0','runId':RUN_ID,'status':status,'finishedAt':utc()})
        print(json.dumps({'status':status,'tests':report['tests'],'coverage':report['coverage'],'mutation':report['mutation'],'postgresStatus':pg.get('status'),'orphans':orphans},indent=2))
        return 0 if status=='passed' else 1
    except KeyboardInterrupt:
        interrupted=True; cleanup_tagged_processes(); raise
    finally:
        try: LOCK.unlink()
        except FileNotFoundError: pass
        if interrupted and GENERATED.exists(): atomic_json(GENERATED/'V23_VALIDATION_INTERRUPTED.json',{'version':'23.0','runId':RUN_ID,'interruptedAt':utc()})

if __name__=='__main__': raise SystemExit(main())
