#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, signal, subprocess, time
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
LOG=OUT/'v31-full-suite.log'
source=sorted(path.stem.removesuffix('.test') for path in (ROOT/'tests').glob('*.test.ts'))
compiled=sorted(path.stem.removesuffix('.test') for path in (ROOT/'dist/tests').glob('*.test.js'))
missing=sorted(set(source)-set(compiled)); extra=sorted(set(compiled)-set(source))
if missing or extra: raise SystemExit(f'test_inventory_mismatch:missing={missing}:extra={extra}')
files=[f'dist/tests/{name}.test.js' for name in source]
cmd=['node','--test','--test-concurrency=4','--test-reporter=tap',*files]
started=time.perf_counter(); started_at=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
with LOG.open('w',encoding='utf-8') as stream:
    process=subprocess.Popen(cmd,cwd=ROOT,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''},stdout=stream,stderr=subprocess.STDOUT,text=True,start_new_session=True)
    timed_out=False
    try: process.wait(timeout=240)
    except subprocess.TimeoutExpired:
        timed_out=True
        try: os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError: pass
        try: process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try: os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            process.wait(timeout=3)
text=LOG.read_text(encoding='utf-8',errors='replace')
def count(label):
    matches=re.findall(rf'^# {re.escape(label)} (\d+)$',text,re.M); return int(matches[-1]) if matches else 0
tests,passed,failed=count('tests'),count('pass'),count('fail')
status='passed' if process.returncode==0 and not timed_out and tests==passed and failed==0 and tests>0 else 'failed'
wall=round((time.perf_counter()-started)*1000,3)
report={'version':'31.0','status':status,'runner':'single authoritative Node TAP process with test concurrency 4, hard process-group timeout and no force-exit','startedAt':started_at,'inventory':{'sourceTestFiles':len(source),'compiledTestFiles':len(compiled),'missing':missing,'extra':extra},'totals':{'testFiles':len(files),'tests':tests,'passed':passed,'failed':failed,'wallDurationMs':wall},'runnerExitCode':process.returncode,'timedOut':timed_out,'testConcurrency':4,'forceExitDisabled':True,'logPath':str(LOG.relative_to(ROOT)),'baseline':{'v30Tests':508,'newTests':tests-508},'limitations':['Single-host test duration is not a production SLO.','External PostgreSQL, HSM/KMS and independent isolation qualification remain separate gates.']}
(OUT/'V31_TEST_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
if status!='passed': print(text[-16000:]); raise SystemExit(1)
