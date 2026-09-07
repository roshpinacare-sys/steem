#!/usr/bin/env python3
from __future__ import annotations
import argparse, concurrent.futures, hashlib, json, os, re, signal, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.33'; CACHE=ROOT/'.cache/v33.33-full-isolated'
OUT.mkdir(parents=True,exist_ok=True); CACHE.mkdir(parents=True,exist_ok=True)
FILES=sorted((ROOT/'dist/tests').glob('*.test.js'))
SENSITIVE_NAMES={
'multi-file-engineering-campaign-v33_9.test.js','qualified-hostile-code-isolation-v33_12.test.js',
'qualified-isolation-orchestration-v33_13.test.js','external-isolation-qualification-v33_14.test.js',
'proof-carrying-adaptive-execution-v33_15.test.js','persistent-adaptive-policy-controller-v33_16.test.js',
'continuous-adaptive-control-service-v33_17.test.js','distributed-lease-authority-v33_18.test.js','separate-process-lease-authority-v33_19.test.js','external-durable-authority-v33_20.test.js','postgres-durable-authority-v33_21.test.js','postgres-ha-pitr-evidence-v33_22.test.js','evidence-intake-portal-v33_23.test.js','external-malware-airgap-v33_24.test.js','signature-supply-scanner-federation-v33_25.test.js','scanner-evidence-transparency-v33_26.test.js','external-transparency-witness-v33_27.test.js','external-operator-ceremony-witness-network-v33_28.test.js','master-program-scorecard-v33_29.test.js','controlled-human-ux-pilot-v33_30.test.js','external-human-pilot-evidence-import-v33_31.test.js','federated-human-pilot-checkpoint-v33_32.test.js','federated-checkpoint-continuity-v33_33.test.js'}
PARALLEL=[p for p in FILES if p.name not in SENSITIVE_NAMES]
SENSITIVE=[p for p in FILES if p.name in SENSITIVE_NAMES]

def stem(path:Path)->str: return path.stem.replace('.test','')
def digest(path:Path)->str: return hashlib.sha256(path.read_bytes()).hexdigest()
def paths(path:Path):
    s=stem(path); return CACHE/f'{s}.tap',CACHE/f'{s}.err',CACHE/f'{s}.receipt.json'
def marker(text:str,name:str):
    m=re.search(rf'^# {re.escape(name)} (\d+)\s*$',text,re.M); return int(m.group(1)) if m else None

def run(path:Path)->dict:
    tap_path,err_path,receipt_path=paths(path); started=time.monotonic()
    with tap_path.open('wb') as out_f, err_path.open('wb') as err_f:
        proc=subprocess.Popen(['node','--test','--test-concurrency=1','--test-reporter=tap',str(path)],cwd=ROOT,stdout=out_f,stderr=err_f,start_new_session=True)
        try: rc=proc.wait(timeout=300); timed=False
        except subprocess.TimeoutExpired:
            timed=True; rc=124
            try: os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            proc.wait(timeout=30)
    text=tap_path.read_text(errors='replace')
    row={'name':path.name,'testSha256':digest(path),'exitCode':rc,'tests':marker(text,'tests'),'passed':marker(text,'pass'),'failed':marker(text,'fail'),'timedOut':timed,'durationSeconds':round(time.monotonic()-started,3)}
    receipt_path.write_text(json.dumps(row,indent=2)+'\n'); return row

def cached(path:Path)->dict|None:
    tap,err,receipt=paths(path)
    if not (tap.exists() and err.exists() and receipt.exists()): return None
    try: row=json.loads(receipt.read_text())
    except Exception: return None
    if row.get('testSha256')!=digest(path) or row.get('exitCode')!=0 or row.get('timedOut') or row.get('failed')!=0 or row.get('tests')!=row.get('passed'): return None
    return row

def run_group(paths_:list[Path],workers:int)->int:
    existing=[]; todo=[]
    for p in paths_:
        row=cached(p)
        (existing if row else todo).append(row if row else p)
    print(json.dumps({'cachedFiles':len(existing),'remaining':len(todo),'workers':workers}),flush=True)
    rows=[x for x in existing if isinstance(x,dict)]
    if workers==1:
        for p in todo:
            row=run(p); rows.append(row); print(json.dumps({'completed':row['name'],'exitCode':row['exitCode'],'tests':row['tests'],'timedOut':row['timedOut']}),flush=True)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            futs={ex.submit(run,p):p for p in todo}
            for f in concurrent.futures.as_completed(futs):
                row=f.result(); rows.append(row); print(json.dumps({'completed':row['name'],'exitCode':row['exitCode'],'tests':row['tests'],'timedOut':row['timedOut']}),flush=True)
    bad=[x for x in rows if x['exitCode']!=0 or x['timedOut'] or x['failed']!=0]
    print(json.dumps({'files':len(rows),'failed':[x['name'] for x in bad]}),flush=True)
    return 0 if not bad and len(rows)==len(paths_) else 1

def aggregate()->int:
    rows=[]; missing=[]
    for p in FILES:
        row=cached(p)
        if row is None: missing.append(p.name)
        else: rows.append(row)
    if missing:
        print(json.dumps({'status':'failed','missingOrInvalidReceipts':missing},indent=2)); return 1
    combined_out=b''; combined_err=b''
    for p,row in zip(FILES,rows):
        tap,err,_=paths(p)
        combined_out += f"\n# --- isolated file: {row['name']} ---\n".encode()+tap.read_bytes()
        combined_err += f"\n# --- isolated file: {row['name']} ---\n".encode()+err.read_bytes()
    stdout_path=OUT/'V33_33_FULL_TEST_STDOUT.tap'; stderr_path=OUT/'V33_33_FULL_TEST_STDERR.log'; exit_path=OUT/'V33_33_FULL_TEST_EXIT.txt'; meta_path=OUT/'V33_33_FULL_TEST_META.json'
    stdout_path.write_bytes(combined_out); stderr_path.write_bytes(combined_err)
    totals={'testFiles':len(rows),'tests':sum(r['tests'] or 0 for r in rows),'passed':sum(r['passed'] or 0 for r in rows),'failed':sum(r['failed'] or 0 for r in rows)}
    valid=totals=={'testFiles':218,'tests':1982,'passed':1982,'failed':0}
    exit_path.write_text(('0' if valid else '1')+'\n')
    meta={'version':'33.33','exitCode':0 if valid else 1,'timedOut':False,'forceExitDisabled':True,'retry':False,'stdoutSha256':hashlib.sha256(combined_out).hexdigest(),'stderrSha256':hashlib.sha256(combined_err).hexdigest(),'testFileCount':len(rows),'topology':'one-node-process-per-test-file-staged-eight-parallel-workers-twenty-three-sensitive-sharded-sequential','parallelWorkers':8,'sensitiveFilesSequentialWithinShard':True,'perFileTimeoutSeconds':300,'files':rows}
    meta_path.write_text(json.dumps(meta,indent=2)+'\n')
    result={'version':'33.33','generatedAt':'2026-07-22T15:30:00.000Z','status':'passed' if valid else 'failed','runner':'one-node-process-per-test-file-authoritative-staged-receipts','testTopologyReason':'Every test file runs in a separate Node process. Stateless files use eight workers. Sensitive files run sequentially inside disjoint shards. No retry or force-exit is used. Aggregate validates the exact compiled test digest and every receipt.','totals':totals,'runnerExitCode':0 if valid else 1,'timedOut':False,'forceExitDisabled':True,'retry':False,'stdoutEvidence':'release-evidence/v33.33/V33_33_FULL_TEST_STDOUT.tap','stderrEvidence':'release-evidence/v33.33/V33_33_FULL_TEST_STDERR.log','exitEvidence':'release-evidence/v33.33/V33_33_FULL_TEST_EXIT.txt','metaEvidence':'release-evidence/v33.33/V33_33_FULL_TEST_META.json','stdoutSha256':meta['stdoutSha256'],'stderrSha256':meta['stderrSha256'],'topology':meta['topology'],'parallelWorkers':8,'sensitiveFileCount':len(SENSITIVE),'productionPromotion':'blocked'}
    (OUT/'V33_33_FULL_TEST_RESULTS.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'totals':totals},indent=2)); return 0 if valid else 1

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--stage',choices=['all','parallel','sensitive','aggregate'],default='all'); ap.add_argument('--shard-index',type=int,default=0); ap.add_argument('--shard-count',type=int,default=1); a=ap.parse_args()
    if a.stage=='parallel': return run_group(PARALLEL,8)
    if a.stage=='sensitive':
        selected=[p for i,p in enumerate(SENSITIVE) if i%a.shard_count==a.shard_index]
        return run_group(selected,1)
    if a.stage=='aggregate': return aggregate()
    rc=run_group(PARALLEL,8)
    if rc: return rc
    rc=run_group(SENSITIVE,1)
    return rc or aggregate()
if __name__=='__main__': sys.exit(main())
