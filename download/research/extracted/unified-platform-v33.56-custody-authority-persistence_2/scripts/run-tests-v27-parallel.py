#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, signal, subprocess, sys, time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated/v27-test-lanes'; OUT.mkdir(parents=True,exist_ok=True)
MAX_WORKERS=max(1,min(int(os.environ.get('V27_TEST_WORKERS','4')),8))
MAX_CAPACITY=max(1,min(int(os.environ.get('V27_TEST_CAPACITY','5')),16))

@dataclass(frozen=True)
class Lane:
    name:str
    tests:tuple[str,...]
    deadline:int
    estimate_ms:int
    resources:tuple[str,...]=()
    concurrency:int=1
    weight:int=1

@dataclass
class Active:
    lane:Lane
    process:subprocess.Popen[str]
    log_path:Path
    stream:object
    started:float
    started_at:str
    peak_rss:int=0

LANES:tuple[Lane,...]=(
 Lane('process-multiprocess',('multiprocess',),70,2300,('sqlite-process',)),
 Lane('repository-change',('repository-change-intake-v24','repository-change-execution-v24','repository-change-review-v24','repository-change-adversarial-v24'),70,10000,('repository-fixture',),4,4),
 Lane('linux-legacy',('linux-isolation',),60,3700,('linux-isolation',),1,2),
 Lane('linux-v23',('linux-isolation-v23',),70,2200,('linux-isolation',),1,2),
 Lane('web-core',('web-server','web-workflow'),60,1500,('loopback-web',),2,2),
 Lane('private-pilot-server',('private-pilot-server',),60,900,('loopback-web',)),
 Lane('canonical-contracts',('adapters','contracts','digital-thread','failure-knowledge','integrated-engineering-commitment','standards-adapters','system-contracts'),50,900,(),3,3),
 Lane('durability-and-keys',('backup-restore','durable','encrypted-keystore','key-lifecycle','postgres-contract'),55,1400,(),2,2),
 Lane('governance-private-platform',('governance-consistency','private-identity','private-pilot-context','artifact-store','release-manifest','telemetry'),55,1450,(),2,2),
 Lane('breakthrough-evidence',('evidence-completeness','offline-verification','decision-brief'),50,500),
 Lane('shadow-flow',('shadow-flow',),45,500),
 Lane('breakthrough-trust-recovery',('capability-trust','capability-trust-concurrency-v22','incident-recertification','recertification-persistence-v26'),65,1100),
 Lane('domain-agent-adapters',('domain-pack-generator','domain-pack-admission-v26','governed-agent','governed-agent-binding-v26','source-adapters-v20','session-archiver'),60,1250,(),2,2),
 Lane('wasm-core',('wasm-capability-runner','wasm-isolation'),50,650,(),2,2),
 Lane('server-config',('private-server-config',),30,300,(),1,2),
 Lane('v22-provenance-clean-state',('test-execution-provenance','clean-state-validation'),55,350),
 Lane('v22-generative-adversarial',('property-invariants-v22','model-based-v22','fuzz-v22'),70,1650,(),3,3),
 Lane('v23-durable-custody',('postgres-hardening-v23','key-custody-rollback-v23'),70,650),
 Lane('wasm-hardening-v23',('wasm-hardening-v23',),60,600),
 Lane('v23-product-value',('human-pilot-slo-v23',),50,250),
 Lane('v24-operations-optimization',('operations-optimization-v24',),50,350),
 Lane('v25-cryptographic-replay',('canonical-json-hardening-v25','replay-ledger-v25'),60,650,('replay-ledger',)),
 Lane('v25-operational-integrity',('telemetry-hardening-v25','invariant-coverage-v25','operational-action-ledger-v25'),55,450),
 Lane('v26-supply-chain-portability',('supply-chain-portability-v26','supply-chain-advisory-v27'),70,1500,('archive-policy',),1,2),
 Lane('v26-design-closure',('design-closure-v26',),45,350),
 Lane('v27-architecture-ai',('architecture-integrity-v27','governed-model-orchestrator-v27','governed-engineering-assistant-v27'),70,1500,(),2,2),
 Lane('v27-persistence-governance',('postgres-branch-matrix-v27','governance-contract-edge-matrix-v27','recertification-store-edge-v27'),70,1200,(),2,2),
 Lane('v27-evidence-trust-artifacts',('evidence-completeness-adversarial-v27','capability-trust-edge-v27','artifact-security-edge-v27','encrypted-keystore-edge-v27'),70,1300,(),2,2),
 Lane('v27-thread-operations-security',('digital-thread-edge-v27','failure-operations-edge-v27','core-security-telemetry-edge-v27','agent-proposal-store-edge-v27'),70,1200,(),2,2),
 Lane('v27-remaining-branch-matrix',('remaining-branch-matrix-v27',),45,400),
)

def validate_suite_inventory()->dict:
    source={path.stem.removesuffix('.test') for path in (ROOT/'tests').glob('*.test.ts')}
    scheduled=[name for lane in LANES for name in lane.tests]
    duplicates=sorted({name for name in scheduled if scheduled.count(name)>1})
    missing=sorted(source-set(scheduled)); extra=sorted(set(scheduled)-source)
    compiled_missing=sorted(name for name in scheduled if not (ROOT/f'dist/tests/{name}.test.js').exists())
    if missing or extra or duplicates or compiled_missing:
        raise RuntimeError(f'test_inventory_mismatch:missing={missing}:extra={extra}:duplicates={duplicates}:compiled_missing={compiled_missing}')
    return {'sourceTestFiles':len(source),'scheduledTestFiles':len(scheduled),'missing':missing,'extra':extra,'duplicates':duplicates,'compiledMissing':compiled_missing}

def count(text:str,label:str)->int:
    matches=re.findall(rf'^# {re.escape(label)} (\d+)$',text,re.M)
    return int(matches[-1]) if matches else 0

def utc()->str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def start_lane(lane:Lane)->Active:
    files=[f'dist/tests/{name}.test.js' for name in lane.tests]
    cmd=['node','--test',f'--test-concurrency={lane.concurrency}','--test-reporter=tap',*files]
    log=OUT/f'{lane.name}.log'
    stream=log.open('w',encoding='utf-8')
    process=subprocess.Popen(cmd,cwd=ROOT,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''},stdout=stream,stderr=subprocess.STDOUT,text=True,start_new_session=True)
    return Active(lane,process,log,stream,time.perf_counter(),utc())

def rss_tree(pid:int)->int:
    # Every lane starts in a new process group. Sum VmRSS only for members of that
    # group, avoiding double-counted descendants and PID-namespace surprises.
    proc=Path('/proc')
    if not proc.exists(): return 0
    total=0
    for entry in proc.iterdir():
        if not entry.name.isdigit(): continue
        try:
            stat=(entry/'stat').read_text()
            after=stat[stat.rfind(')')+2:].split()
            process_group=int(after[2])
            if process_group != pid: continue
            for line in (entry/'status').read_text().splitlines():
                if line.startswith('VmRSS:'):
                    total += int(line.split()[1])*1024
                    break
        except (FileNotFoundError,ProcessLookupError,PermissionError,ValueError,IndexError):
            continue
    return total

def stop(active:Active)->None:
    try: os.killpg(active.process.pid,signal.SIGTERM)
    except ProcessLookupError: return
    try: active.process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try: os.killpg(active.process.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        active.process.wait(timeout=2)

def finalize(active:Active,timed_out:bool=False)->dict:
    active.stream.close()
    elapsed=round((time.perf_counter()-active.started)*1000,3)
    output=active.log_path.read_text(encoding='utf-8',errors='replace')
    tests,passed,failed=count(output,'tests'),count(output,'pass'),count(output,'fail')
    rc=active.process.returncode
    status='passed' if rc==0 and not timed_out and tests>0 and tests==passed and failed==0 else ('timed-out' if timed_out else 'failed')
    return {
      'lane':active.lane.name,'testFiles':[f'dist/tests/{name}.test.js' for name in active.lane.tests],
      'resources':list(active.lane.resources),'tests':tests,'passed':passed,'failed':failed,
      'runnerExitCode':rc,'timedOut':timed_out,'durationMs':elapsed,'peakRssBytes':active.peak_rss,
      'status':status,'startedAt':active.started_at,'path':str(active.log_path.relative_to(ROOT)),
      'forceExitDisabled':True,'testConcurrency':active.lane.concurrency,'schedulerWeight':active.lane.weight,'deadlineSeconds':active.lane.deadline,
    }

def main()->int:
    inventory=validate_suite_inventory()
    pending=sorted(LANES,key=lambda lane:(-lane.estimate_ms,lane.name))
    active:list[Active]=[]; records=[]; used_resources:set[str]=set(); used_capacity=0; failed=False
    suite_started=time.perf_counter(); max_parallel=0; aggregate_peak=0
    while pending or active:
        launched=True
        while launched and len(active)<MAX_WORKERS and not failed:
            launched=False
            for index,lane in enumerate(pending):
                if used_resources.intersection(lane.resources) or used_capacity + lane.weight > MAX_CAPACITY: continue
                pending.pop(index)
                item=start_lane(lane); active.append(item); used_resources.update(lane.resources); used_capacity += lane.weight
                print(json.dumps({'event':'lane-started','lane':lane.name,'pid':item.process.pid,'resources':lane.resources}),flush=True)
                launched=True; break
        max_parallel=max(max_parallel,len(active))
        aggregate_peak=max(aggregate_peak,sum(rss_tree(item.process.pid) for item in active))
        if not active and pending:
            raise RuntimeError('scheduler_deadlock')
        time.sleep(.03)
        for item in list(active):
            item.peak_rss=max(item.peak_rss,rss_tree(item.process.pid))
            timed_out=(time.perf_counter()-item.started)>item.lane.deadline
            if timed_out and item.process.poll() is None: stop(item)
            if item.process.poll() is not None:
                record=finalize(item,timed_out); records.append(record); active.remove(item)
                for resource in item.lane.resources: used_resources.discard(resource)
                used_capacity -= item.lane.weight
                print(json.dumps(record),flush=True)
                if record['status']!='passed':
                    failed=True
                    tail=item.log_path.read_text(errors='replace')[-12000:]
                    print(tail,file=sys.stderr)
                    for other in active: stop(other)
        if failed:
            for item in list(active):
                records.append(finalize(item,False)); active.remove(item)
            break
    wall=round((time.perf_counter()-suite_started)*1000,3)
    records.sort(key=lambda record:record['lane'])
    totals={'testFiles':sum(len(r['testFiles']) for r in records),'tests':sum(r['tests'] for r in records),'passed':sum(r['passed'] for r in records),'failed':sum(r['failed'] for r in records),'wallDurationMs':wall,'serialLaneDurationMs':round(sum(r['durationMs'] for r in records),3),'maxParallelLanes':max_parallel,'aggregatePeakRssBytes':aggregate_peak}
    status='passed' if len(records)==len(LANES) and all(r['status']=='passed' for r in records) else 'failed'
    baseline=15070.833
    report={
      'version':'27.0','status':status,'runner':'resource-aware parallel subprocess scheduler with hard deadlines, TAP execution counting, no force-exit and process-group cleanup',
      'workerLimit':MAX_WORKERS,'capacityLimit':MAX_CAPACITY,'inventory':inventory,'lanes':records,'totals':totals,
      'performance':{'publishedV25FreshExtractionBaselineMs':baseline,'wallTimeRatioVsPublishedBaseline':round(wall/baseline,3) if baseline else None,'wallDurationDeltaMs':round(wall-baseline,3),'testCountMustNotDecrease':288,'currentTestCount':totals['tests']},
      'qualityModel':{'countsExecutedTapOnly':True,'forceExitForbidden':True,'resourceConflictsSerialized':True,'timeoutsFailClosed':True,'processGroupsCleanedOnFailure':True,'fullSuiteAuthoritative':True},
      'limitations':['Parallel speed depends on host CPU and storage.','PostgreSQL multi-host behavior, real HSM/KMS, moderated users and external security review remain separate gates.'],
    }
    (ROOT/'evidence/generated/V27_TEST_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':status,'totals':totals,'performance':report['performance']},indent=2),flush=True)
    return 0 if status=='passed' else 1

if __name__=='__main__': raise SystemExit(main())
