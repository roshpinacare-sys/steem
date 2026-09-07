#!/usr/bin/env python3
from __future__ import annotations
import concurrent.futures, json, re, shutil, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.cache/v33.16-direct'
shutil.rmtree(OUT,ignore_errors=True);OUT.mkdir(parents=True)
parallel=[
'chat-mission-v33_1','mission-conversation-v33_2','device-push-v33_3','reliable-push-v33_4',
'push-adapter-qualification-v33_5','human-pilot-readiness-v33_6','controlled-pilot-and-market-v33_7',
'chat-engineering-vertical-v33_8','external-git-provider-qualification-v33_10','malicious-repository-admission-v33_11']
sensitive=['multi-file-engineering-campaign-v33_9','qualified-hostile-code-isolation-v33_12','qualified-isolation-orchestration-v33_13','external-isolation-qualification-v33_14','proof-carrying-adaptive-execution-v33_15','persistent-adaptive-policy-controller-v33_16']

def run(name:str)->dict:
    cmd=['node','--test','--test-concurrency=1','--test-reporter=tap',str(ROOT/f'dist/tests/{name}.test.js')]
    started=time.monotonic()
    try:
        p=subprocess.run(cmd,cwd=ROOT,capture_output=True,timeout=300)
        rc=p.returncode; timed=False; stdout=p.stdout; stderr=p.stderr
    except subprocess.TimeoutExpired as e:
        rc=124;timed=True;stdout=e.stdout or b'';stderr=e.stderr or b''
    (OUT/f'{name}.tap').write_bytes(stdout);(OUT/f'{name}.err').write_bytes(stderr);(OUT/f'{name}.exit').write_text(str(rc)+'\n')
    text=stdout.decode('utf8','replace')
    def marker(k:str):
        m=re.search(rf'^# {re.escape(k)} (\d+)\s*$',text,re.M);return int(m.group(1)) if m else None
    return {'name':name,'exitCode':rc,'tests':marker('tests'),'passed':marker('pass'),'failed':marker('fail'),'timedOut':timed,'durationSeconds':round(time.monotonic()-started,3)}

started=time.monotonic(); rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
    fut={ex.submit(run,n):n for n in parallel}
    for f in concurrent.futures.as_completed(fut): rows.append(f.result())
for name in sensitive: rows.append(run(name))
order=parallel+sensitive; rows.sort(key=lambda r:order.index(r['name']))
totals={'testFiles':len(rows),'tests':sum((r['tests'] or 0) for r in rows),'passed':sum((r['passed'] or 0) for r in rows),'failed':sum((r['failed'] or 0) for r in rows)}
valid=totals=={'testFiles':16,'tests':268,'passed':268,'failed':0} and all(r['exitCode']==0 and not r['timedOut'] for r in rows)
result={'version':'33.16','status':'passed' if valid else 'failed','runner':'one-node-process-per-v33-test-file','parallelStatelessWorkers':4,'sensitiveFilesSequential':True,'retry':False,'forceExit':False,'perFileTimeoutSeconds':300,'durationSeconds':round(time.monotonic()-started,3),'totals':totals,'files':rows}
(OUT/'V33_16_DIRECT_V33_RESULTS.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
sys.exit(0 if valid else 1)
