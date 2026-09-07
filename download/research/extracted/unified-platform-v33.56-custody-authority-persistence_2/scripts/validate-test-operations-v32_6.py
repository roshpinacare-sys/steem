#!/usr/bin/env python3
from __future__ import annotations
import argparse,hashlib,json,os,shutil,subprocess,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT
STAGES={'build-benchmark':['python3','scripts/benchmark-incremental-build-v32_6.py'],'profile':['python3','scripts/profile-tests-v32_6.py','--workers','4','--samples','1'],'core':['python3','scripts/run-tests-v32_6.py','--mode','core','--no-build'],'quick':['python3','scripts/run-tests-v32_6.py','--mode','quick','--no-build'],'full':['python3','scripts/run-tests-v32_6.py','--mode','full','--no-build'],'qualification':['python3','scripts/run-tests-v32_6.py','--mode','qualification','--no-build'],'mutation':['python3','scripts/run-test-operations-mutation-v32_6.py'],'stability':['python3','scripts/stability-v32_6.py'],'coverage':['python3','scripts/run-legacy-gate-v32_6.py','coverage'],'quality':['python3','scripts/run-legacy-gate-v32_6.py','quality'],'architecture':['python3','scripts/run-legacy-gate-v32_6.py','architecture'],'throughput':['python3','scripts/test-throughput-report-v32_6.py']}
REPORTS={'build-benchmark':'V32_6_INCREMENTAL_BUILD_BENCHMARK.json','profile':'V32_6_TEST_FILE_PROFILE.json','core':'V32_6_CORE_TEST_RESULTS.json','quick':'V32_6_QUICK_TEST_RESULTS.json','full':'V32_6_FULL_TEST_RESULTS.json','qualification':'V32_6_QUALIFICATION_TEST_RESULTS.json','mutation':'V32_6_TEST_OPERATIONS_MUTATION_RESULTS.json','stability':'V32_6_STABILITY_REPORT.json','coverage':'V32_COVERAGE_REPORT.json','quality':'V32_TEST_QUALITY_AUDIT.json','architecture':'V32_ARCHITECTURE_INTEGRITY.json','throughput':'V32_6_TEST_THROUGHPUT_REPORT.json'};FIELDS=['sourceDigest','compiledArtifactDigest','testManifestDigest','testFilesDigest','packageLockDigest','environmentDigest']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def env(d,i):return{**os.environ,'NODE_ENV':'test','NODE_OPTIONS':'','V32_6_RUN_ID':d.name,'V32_6_RUN_DIR':str(d),**{f'V32_6_{k.replace("Digest", "_DIGEST").upper()}':str(i[k])for k in FIELDS}}
def command(cmd,log,environment,timeout=420):
 t=time.perf_counter()
 with log.open('w')as s:p=subprocess.run(cmd,cwd=ROOT,text=True,stdout=s,stderr=subprocess.STDOUT,env=environment,timeout=timeout)
 return p.returncode,round((time.perf_counter()-t)*1000,3)
def create(run_id):
 d=(ctx.RUNS_ROOT/ctx.sanitize_run_id(run_id)).resolve();shutil.rmtree(d,ignore_errors=True);d.mkdir(parents=True);pre=ctx.source_digest();code,duration=command(['npm','run','build:clean:v32'],d/'build-clean.log',{**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''},180)
 if code:raise SystemExit(code)
 if ctx.source_digest()!=pre:raise SystemExit('source_changed_during_build')
 i=ctx.execution_identity();m={'version':'32.6.1','runId':d.name,'status':'IN_PROGRESS','createdAt':ctx.utc(),'identity':i,'cleanBuild':{'status':'passed','durationMs':duration},'stages':{}};ctx.atomic_write_json(d/'RUN_MANIFEST.json',m);ctx.atomic_write_json(ctx.CURRENT_POINTER,{'version':'32.6.1','runId':d.name,'runDirectory':d.relative_to(ROOT).as_posix(),'sourceDigest':i['sourceDigest'],'compiledArtifactDigest':i['compiledArtifactDigest'],'updatedAt':ctx.utc()});return d,m
def load(run_id):
 d=(ctx.RUNS_ROOT/ctx.sanitize_run_id(run_id)).resolve();return d,json.loads((d/'RUN_MANIFEST.json').read_text())
def save(d,m):ctx.atomic_write_json(d/'RUN_MANIFEST.json',m)
def coherent(report,i):return all(report.get(f)==i.get(f)for f in FIELDS)
def stage(name,d,m):
 before=ctx.execution_identity();ctx.assert_identity(m['identity'],before);log=d/f'{name}.log'
 try:code,duration=command(STAGES[name],log,env(d,m['identity']),600 if name in('profile','coverage','stability')else 300)
 except subprocess.TimeoutExpired:code=124;duration=0
 unchanged=ctx.execution_identity()==before==m['identity'];path=d/REPORTS[name];exists=path.exists();ok=False
 if exists:
  try:ok=coherent(json.loads(path.read_text()),m['identity'])
  except Exception:pass
 row={'status':'passed'if code==0 and unchanged and exists and ok else'failed','exitCode':code,'durationMs':duration,'report':path.relative_to(ROOT).as_posix(),'identityCoherent':ok,'identityUnchanged':unchanged};m['stages'][name]=row;save(d,m);print(json.dumps({'name':name,**row},indent=2))
 if row['status']!='passed':print(log.read_text(errors='replace')[-15000:],file=sys.stderr);raise SystemExit(code or 1)
def finalize(d,m):
 missing=[n for n in STAGES if m['stages'].get(n,{}).get('status')!='passed']
 if missing:raise SystemExit('missing_stages:'+','.join(missing))
 i=m['identity'];ctx.assert_identity(i);r={n:json.loads((d/f).read_text())for n,f in REPORTS.items()};checks={n:coherent(v,i)for n,v in r.items()};full=r['full'];core=r['core'];quick=r['quick'];qual=r['qualification'];mut=r['mutation'];st=r['stability'];cov=r['coverage'];quality=r['quality'];arch=r['architecture'];tp=r['throughput'];prof=r['profile'];build=r['build-benchmark'];assertions={'allReportsOneIdentity':all(checks.values()),'fullPassed':full['status']=='passed'and full['tests']==full['passed']and full['failed']==0 and full['tests']>=736 and not full['lifecycleLeakDetected'],'coreFastBroad':core['status']=='passed'and core['tests']>=620 and core['wallDurationMs']<=15000,'quickFast':quick['status']=='passed'and quick['tests']>=20 and quick['wallDurationMs']<=2000,'qualificationSeparated':qual['status']=='passed'and qual['tests']>0,'profileComplete':prof['status']=='passed'and prof['files']==full['selectedCount']and prof['timingSemantics']['queueWaitExcludedFromTestCost'],'incrementalBuild':build['status']=='passed'and build['allWithinBudget'],'mutationAuthentic':mut['status']=='passed'and mut['baseline']['status']=='passed'and mut['mutantsSpecified']==mut['mutantsKilledAuthentically']and mut['invalidKills']==0 and mut['survivors']==0,'stability':st['status']=='passed'and st['flakeCount']==0 and len(st['runs'])==3,'coverage':cov['status']=='passed'and cov['current']['linePercent']>=99 and cov['current']['branchPercent']>=96 and cov['current']['functionPercent']>=98.5,'quality':quality['status']=='passed'and quality['criticalOrHighIssues']==0 and quality['mediumIssues']==0,'architecture':arch['status']=='PASS'and arch['metrics']['sourceCycleCount']==0 and arch['metrics']['untestedSourceCount']==0,'throughput':tp['status']=='passed'and tp['evidenceIdentityCoherent']};status='passed'if all(assertions.values())else'failed';report={'version':'32.6.1','runId':d.name,'status':status,'classification':'coherent-scalable-tiered-test-operations',**i,'assertions':assertions,'results':{'tests':{'full':full['tests'],'core':core['tests'],'quick':quick['tests'],'qualification':qual['tests']},'wallMs':{'full':full['wallDurationMs'],'core':core['wallDurationMs'],'quick':quick['wallDurationMs'],'qualification':qual['wallDurationMs']},'coverage':cov['current'],'mutations':{k:mut[k]for k in('mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},'stability':st['statistics'],'architecture':arch['metrics'],'improvements':tp['improvements']},'limitations':tp['limitations']};ctx.atomic_write_json(d/'V32_6_TEST_OPERATIONS_FINAL_VALIDATION.json',report);m['status']=status.upper();m['finishedAt']=ctx.utc();m['reports']=[{'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size}for p in sorted(d.iterdir())if p.is_file()and p.name!='RUN_MANIFEST.json'];save(d,m);print(json.dumps(report,indent=2));return report
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--run-id',default='v32.6.1-final');ap.add_argument('--initialize',action='store_true');ap.add_argument('--stage',choices=list(STAGES));ap.add_argument('--finalize',action='store_true');a=ap.parse_args()
 if a.initialize:d,m=create(a.run_id);print(json.dumps({'runId':d.name,'runDirectory':str(d),'identity':m['identity']},indent=2));return
 d,m=load(a.run_id)
 if a.stage:stage(a.stage,d,m);return
 if a.finalize:raise SystemExit(0 if finalize(d,m)['status']=='passed'else 1)
 d,m=create(a.run_id)
 for n in STAGES:stage(n,d,m)
 raise SystemExit(0 if finalize(d,m)['status']=='passed'else 1)
if __name__=='__main__':main()
