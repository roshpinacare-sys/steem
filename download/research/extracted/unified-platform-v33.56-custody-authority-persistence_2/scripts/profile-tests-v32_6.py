#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,os,re,signal,statistics,subprocess,sys,time,threading
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
SCRIPT_DIR=Path(__file__).resolve().parent;sys.path.insert(0,str(SCRIPT_DIR));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();CONFIG=json.loads((ROOT/'config/test-operations-v32_6.json').read_text());LOCKS={};LOCKS_GUARD=threading.Lock()
def count(text,label):
 m=re.findall(rf'^# {re.escape(label)} (\d+)$',text,re.M);return int(m[-1])if m else 0
def tap_complete(text):
 tests=count(text,'tests');passed=count(text,'pass');failed=count(text,'fail');cancelled=count(text,'cancelled');skipped=count(text,'skipped');plans=[int(x)for x in re.findall(r'^1\.\.(\d+)$',text,re.M)]
 return tests>0 and bool(plans) and plans[-1]==tests and passed+failed+cancelled+skipped>=tests
def resources(file):
 out=[]
 for pattern,items in CONFIG['resourceRules'].items():
  if pattern in file:out.extend(items)
 return sorted(set(out))
def get_lock(name):
 with LOCKS_GUARD:
  if name not in LOCKS:LOCKS[name]=threading.Lock()
  return LOCKS[name]
def terminate(p):
 if p.poll()is not None:return
 try:os.killpg(p.pid,signal.SIGTERM)
 except ProcessLookupError:return
 try:p.wait(timeout=2)
 except subprocess.TimeoutExpired:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  p.wait(timeout=2)
def wait_protocol(p,tap,timeout,grace=.75):
 deadline=time.monotonic()+timeout;complete_at=None
 while True:
  code=p.poll()
  if code is not None:return code,False,False
  text=tap.read_text(errors='replace')if tap.exists()else''
  if tap_complete(text):
   if complete_at is None:complete_at=time.monotonic()
   elif time.monotonic()-complete_at>=grace:
    terminate(p);return 0,False,True
  if time.monotonic()>=deadline:
   terminate(p);return p.returncode if p.returncode is not None else 124,True,False
  time.sleep(.05)
def run_one(file,sample,timeout=30):
 locks=[get_lock(x)for x in resources(file)];queued=time.perf_counter()
 for l in locks:l.acquire()
 started=time.perf_counter();queue=(started-queued)*1000;tap=OUT/f'.profile-{Path(file).stem}-{sample}.tap.log'
 try:
  with tap.open('w')as stream:p=subprocess.Popen(['node','--test','--test-concurrency=1','--test-force-exit',file],cwd=ROOT,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''})
  code,timed,reaped=wait_protocol(p,tap,timeout);execution=(time.perf_counter()-started)*1000;text=tap.read_text(errors='replace')if tap.exists()else''
  return{'file':file,'sample':sample,'queueWaitMs':round(queue,3),'executionWallMs':round(execution,3),'totalWallMs':round(queue+execution,3),'wallMs':round(execution,3),'exitCode':code,'timedOut':timed,'reapedAfterTap':reaped,'tapComplete':tap_complete(text),'resources':resources(file),'tests':count(text,'tests'),'passed':count(text,'pass'),'failed':count(text,'fail'),'outputTail':text[-1000:]if code else''}
 finally:
  tap.unlink(missing_ok=True)
  for l in reversed(locks):l.release()
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--workers',type=int,default=4);ap.add_argument('--samples',type=int,default=1);a=ap.parse_args();files=sorted(f'dist/tests/{p.name}'for p in (ROOT/'dist/tests').glob('*.test.js'));started=time.perf_counter();details=[]
 with ThreadPoolExecutor(max_workers=max(1,min(a.workers,4)))as ex:
  futures=[ex.submit(run_one,f,s+1)for f in files for s in range(a.samples)]
  for future in as_completed(futures):details.append(future.result())
 rows=[]
 for f in files:
  ds=[d for d in details if d['file']==f];execution=[d['executionWallMs']for d in ds];queue=[d['queueWaitMs']for d in ds];total=[d['totalWallMs']for d in ds]
  rows.append({'file':f,'samples':len(ds),'executionWallMs':round(statistics.median(execution),3),'executionP90Ms':round(max(execution),3),'queueWaitMs':round(statistics.median(queue),3),'totalWallMs':round(statistics.median(total),3),'wallMs':round(statistics.median(execution),3),'exitCode':max(d['exitCode']for d in ds),'timedOut':any(d['timedOut']for d in ds),'reapedAfterTap':any(d['reapedAfterTap']for d in ds),'tapComplete':all(d['tapComplete']for d in ds),'resources':resources(f),'tests':max(d['tests']for d in ds),'passed':max(d['passed']for d in ds),'failed':max(d['failed']for d in ds),'sampleDetails':ds})
 rows.sort(key=lambda r:(-r['executionWallMs'],r['file']));passed=all(r['exitCode']==0 and not r['timedOut']and r['failed']==0 and r['tapComplete']for r in rows);identity=ctx.execution_identity();report={'version':'32.7','runId':OUT.name,'status':'passed'if passed else'failed',**identity,'files':len(rows),'samplesPerFile':a.samples,'workers':a.workers,'profileWallMs':round((time.perf_counter()-started)*1000,3),'timingSemantics':{'queueWaitExcludedFromTestCost':True,'planningField':'executionWallMs','tapCompleteProcessGroupReapAllowed':True},'reapedAfterTapCount':sum(r['reapedAfterTap']for r in rows),'rows':rows,'top':rows[:15]};ctx.atomic_write_json(OUT/'V32_6_TEST_FILE_PROFILE.json',report);print(json.dumps({'status':report['status'],'files':report['files'],'profileWallMs':report['profileWallMs'],'reapedAfterTapCount':report['reapedAfterTapCount'],'top':report['top'][:5]},indent=2));return 0 if passed else 1
if __name__=='__main__':raise SystemExit(main())
