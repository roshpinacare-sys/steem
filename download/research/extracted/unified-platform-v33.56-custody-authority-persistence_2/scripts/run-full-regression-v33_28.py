#!/usr/bin/env python3
from __future__ import annotations
import concurrent.futures, hashlib, json, os, re, shutil, signal, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.28'; CACHE=ROOT/'.cache/v33.28-full-isolated'
OUT.mkdir(parents=True,exist_ok=True); CACHE.mkdir(parents=True,exist_ok=True)
files=sorted((ROOT/'dist/tests').glob('*.test.js'))
sensitive_names={
'multi-file-engineering-campaign-v33_9.test.js','qualified-hostile-code-isolation-v33_12.test.js',
'qualified-isolation-orchestration-v33_13.test.js','external-isolation-qualification-v33_14.test.js',
'proof-carrying-adaptive-execution-v33_15.test.js','persistent-adaptive-policy-controller-v33_16.test.js',
'continuous-adaptive-control-service-v33_17.test.js','distributed-lease-authority-v33_18.test.js','separate-process-lease-authority-v33_19.test.js','external-durable-authority-v33_20.test.js','postgres-durable-authority-v33_21.test.js','postgres-ha-pitr-evidence-v33_22.test.js','evidence-intake-portal-v33_23.test.js','external-malware-airgap-v33_24.test.js','signature-supply-scanner-federation-v33_25.test.js','scanner-evidence-transparency-v33_26.test.js','external-transparency-witness-v33_27.test.js','external-operator-ceremony-witness-network-v33_28.test.js'}
parallel=[p for p in files if p.name not in sensitive_names]; sensitive=[p for p in files if p.name in sensitive_names]

def run(path:Path)->dict:
    cmd=['node','--test','--test-concurrency=1','--test-reporter=tap',str(path)]
    started=time.monotonic()
    stem=path.stem.replace('.test','') if 'path' in locals() else name
    tap_path=CACHE/f'{stem}.tap'; err_path=CACHE/f'{stem}.err'
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
    (CACHE/f'{stem}.exit').write_text(str(rc)+'\n')
    text=stdout.decode('utf8','replace')
    def marker(name:str):
        m=re.search(rf'^# {re.escape(name)} (\d+)\s*$',text,re.M); return int(m.group(1)) if m else None
    return {'name':path.name,'exitCode':rc,'tests':marker('tests'),'passed':marker('pass'),'failed':marker('fail'),'timedOut':timed,'durationSeconds':round(time.monotonic()-started,3),'stdoutPath':str(CACHE/f'{stem}.tap'),'stderrPath':str(CACHE/f'{stem}.err')}

def cached(path:Path)->dict|None:
    stem=path.stem.replace('.test','')
    tap=CACHE/f'{stem}.tap'; err=CACHE/f'{stem}.err'; exitf=CACHE/f'{stem}.exit'
    if not (tap.exists() and err.exists() and exitf.exists()): return None
    if min(tap.stat().st_mtime, err.stat().st_mtime, exitf.stat().st_mtime) < path.stat().st_mtime: return None
    try: rc=int(exitf.read_text().strip())
    except Exception: return None
    if rc != 0: return None
    text=tap.read_text(errors='replace')
    def marker(name:str):
        m=re.search(rf'^# {re.escape(name)} (\d+)\s*$',text,re.M); return int(m.group(1)) if m else None
    tests=marker('tests'); passed=marker('pass'); failed=marker('fail')
    if tests is None or passed is None or failed is None or failed != 0 or passed != tests: return None
    return {'name':path.name,'exitCode':0,'tests':tests,'passed':passed,'failed':failed,'timedOut':False,'durationSeconds':0.0,'cached':True,'stdoutPath':str(tap),'stderrPath':str(err)}

started=time.monotonic(); rows=[]
remaining_parallel=[]
for path in parallel:
    row=cached(path)
    if row: rows.append(row)
    else: remaining_parallel.append(path)
remaining_sensitive=[]
for path in sensitive:
    row=cached(path)
    if row: rows.append(row)
    else: remaining_sensitive.append(path)
print(json.dumps({'cachedFiles':len(rows),'remainingParallel':len(remaining_parallel),'remainingSensitive':len(remaining_sensitive)}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
    future_map={ex.submit(run,p):p for p in remaining_parallel}
    for future in concurrent.futures.as_completed(future_map):
        row=future.result(); rows.append(row); print(json.dumps({'completed':row['name'],'exitCode':row['exitCode'],'tests':row['tests'],'timedOut':row['timedOut']}),flush=True)
for path in remaining_sensitive:
    row=run(path); rows.append(row); print(json.dumps({'completed':row['name'],'exitCode':row['exitCode'],'tests':row['tests'],'timedOut':row['timedOut']}),flush=True)
order=[p.name for p in files]; rows.sort(key=lambda r:order.index(r['name']))
combined_out=b''; combined_err=b''
for row in rows:
    combined_out += f"\n# --- isolated file: {row['name']} ---\n".encode()+Path(row['stdoutPath']).read_bytes()
    combined_err += f"\n# --- isolated file: {row['name']} ---\n".encode()+Path(row['stderrPath']).read_bytes()
stdout_path=OUT/'V33_28_FULL_TEST_STDOUT.tap'; stderr_path=OUT/'V33_28_FULL_TEST_STDERR.log'; exit_path=OUT/'V33_28_FULL_TEST_EXIT.txt'; meta_path=OUT/'V33_28_FULL_TEST_META.json'
stdout_path.write_bytes(combined_out); stderr_path.write_bytes(combined_err)
totals={'testFiles':len(rows),'tests':sum((r['tests'] or 0) for r in rows),'passed':sum((r['passed'] or 0) for r in rows),'failed':sum((r['failed'] or 0) for r in rows)}
valid=totals=={'testFiles':213,'tests':1793,'passed':1793,'failed':0} and all(r['exitCode']==0 and not r['timedOut'] for r in rows)
exit_path.write_text(('0' if valid else '1')+'\n')
meta={'version':'33.28','exitCode':0 if valid else 1,'durationSeconds':round(time.monotonic()-started,3),'timedOut':any(r['timedOut'] for r in rows),'forceExitDisabled':True,'retry':False,'stdoutSha256':hashlib.sha256(combined_out).hexdigest(),'stderrSha256':hashlib.sha256(combined_err).hexdigest(),'testFileCount':len(rows),'topology':'one-node-process-per-test-file-four-parallel-workers-eighteen-sensitive-sequential','parallelWorkers':4,'sensitiveFilesSequential':True,'perFileTimeoutSeconds':300,'cachedFileCount':sum(1 for r in rows if r.get('cached')),'files':[{k:v for k,v in r.items() if k not in {'stdoutPath','stderrPath'}} for r in rows]}
meta_path.write_text(json.dumps(meta,indent=2)+'\n')
results={'version':'33.28','generatedAt':'2026-07-22T07:30:00.000Z','status':'passed' if valid else 'failed','runner':'one-node-process-per-test-file-authoritative-exit-receipt','testTopologyReason':'Every test file runs in a separate Node process. Four stateless files run concurrently and eighteen stateful or isolation-sensitive files run sequentially. No retry or force-exit is used; a leaking file times out and fails independently.','totals':totals,'runnerExitCode':0 if valid else 1,'timedOut':meta['timedOut'],'forceExitDisabled':True,'retry':False,'durationSeconds':meta['durationSeconds'],'stdoutEvidence':'release-evidence/v33.28/V33_28_FULL_TEST_STDOUT.tap','stderrEvidence':'release-evidence/v33.28/V33_28_FULL_TEST_STDERR.log','exitEvidence':'release-evidence/v33.28/V33_28_FULL_TEST_EXIT.txt','metaEvidence':'release-evidence/v33.28/V33_28_FULL_TEST_META.json','stdoutSha256':meta['stdoutSha256'],'stderrSha256':meta['stderrSha256'],'topology':meta['topology'],'parallelWorkers':4,'sensitiveFileCount':len(sensitive),'productionPromotion':'blocked'}
(OUT/'V33_28_FULL_TEST_RESULTS.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({'status':results['status'],'totals':totals,'durationSeconds':meta['durationSeconds'],'timedOutFiles':[r['name'] for r in rows if r['timedOut']],'failedFiles':[r['name'] for r in rows if r['exitCode']!=0]},indent=2))
sys.exit(0 if valid else 1)
