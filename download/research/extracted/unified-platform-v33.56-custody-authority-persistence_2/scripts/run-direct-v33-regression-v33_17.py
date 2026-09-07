#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, shutil, signal, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.cache/v33.17-direct'
shutil.rmtree(OUT,ignore_errors=True);OUT.mkdir(parents=True)
parallel=[
'chat-mission-v33_1','mission-conversation-v33_2','device-push-v33_3','reliable-push-v33_4',
'push-adapter-qualification-v33_5','human-pilot-readiness-v33_6','controlled-pilot-and-market-v33_7',
'chat-engineering-vertical-v33_8','external-git-provider-qualification-v33_10','malicious-repository-admission-v33_11']
sensitive=['multi-file-engineering-campaign-v33_9','qualified-hostile-code-isolation-v33_12','qualified-isolation-orchestration-v33_13','external-isolation-qualification-v33_14','proof-carrying-adaptive-execution-v33_15','persistent-adaptive-policy-controller-v33_16','continuous-adaptive-control-service-v33_17']

def run(name:str)->dict:
    cmd=['node','--test','--test-concurrency=1','--test-reporter=tap',str(ROOT/f'dist/tests/{name}.test.js')]
    started=time.monotonic()
    stem=path.stem.replace('.test','') if 'path' in locals() else name
    tap_path=OUT/f'{stem}.tap'; err_path=OUT/f'{stem}.err'
    with tap_path.open('wb') as out_f, err_path.open('wb') as err_f:
        proc=subprocess.Popen(cmd,cwd=ROOT,stdout=out_f,stderr=err_f,start_new_session=True)
        try:
            rc=proc.wait(timeout=300); timed=False
        except subprocess.TimeoutExpired:
            timed=True; rc=124
            try: os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            proc.wait(timeout=30)
    stdout=tap_path.read_bytes(); stderr=err_path.read_bytes()
    (OUT/f'{name}.exit').write_text(str(rc)+'\n')
    text=stdout.decode('utf8','replace')
    def marker(k:str):
        m=re.search(rf'^# {re.escape(k)} (\d+)\s*$',text,re.M);return int(m.group(1)) if m else None
    return {'name':name,'exitCode':rc,'tests':marker('tests'),'passed':marker('pass'),'failed':marker('fail'),'timedOut':timed,'durationSeconds':round(time.monotonic()-started,3)}

started=time.monotonic(); rows=[]
order=parallel+sensitive
for name in order:
    row=run(name); rows.append(row)
    print(json.dumps({'completed':name,'exitCode':row['exitCode'],'tests':row['tests'],'timedOut':row['timedOut']}),flush=True)
totals={'testFiles':len(rows),'tests':sum((r['tests'] or 0) for r in rows),'passed':sum((r['passed'] or 0) for r in rows),'failed':sum((r['failed'] or 0) for r in rows)}
valid=totals=={'testFiles':17,'tests':288,'passed':288,'failed':0} and all(r['exitCode']==0 and not r['timedOut'] for r in rows)
result={'version':'33.17','status':'passed' if valid else 'failed','runner':'one-node-process-per-v33-test-file','parallelStatelessWorkers':0,'allFilesSequential':True,'sensitiveFilesSequential':True,'retry':False,'forceExit':False,'perFileTimeoutSeconds':300,'durationSeconds':round(time.monotonic()-started,3),'totals':totals,'files':rows}
(OUT/'V33_17_DIRECT_V33_RESULTS.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
sys.exit(0 if valid else 1)
