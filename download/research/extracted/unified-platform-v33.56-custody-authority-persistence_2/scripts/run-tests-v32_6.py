#!/usr/bin/env python3
from __future__ import annotations
import argparse,hashlib,json,os,re,signal,subprocess,sys,time
from datetime import datetime,timezone
from pathlib import Path
SCRIPT_DIR=Path(__file__).resolve().parent;sys.path.insert(0,str(SCRIPT_DIR));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();CACHE=ROOT/'.cache/v32_6-test-operations';CACHE.mkdir(parents=True,exist_ok=True);CONFIG=json.loads((ROOT/'config/test-operations-v32_6.json').read_text());PROFILE_PATH=OUT/'V32_6_TEST_FILE_PROFILE.json';FALLBACK_PROFILE=ROOT/'release-evidence/V32_6_TEST_FILE_PROFILE.json';IMPACT_STATE=CACHE/'impact-state.json'
IMPORT_RE=re.compile(r"(?:from\s+|import\s*\()\s*['\"]([^'\"]+)['\"]");PATH_RE=re.compile(r"['\"]((?:dist/)?(?:src|scripts|config|\.github)/[^'\"]+)['\"]")
def utc():return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def sha(p:Path):return hashlib.sha256(p.read_bytes()).hexdigest()
def rel(p:Path):return p.relative_to(ROOT).as_posix()
def count(text,label):
 m=re.findall(rf'^# {re.escape(label)} (\d+)$',text,re.M);return int(m[-1]) if m else 0
def inventory():
 src=sorted(p.stem.removesuffix('.test') for p in (ROOT/'tests').glob('*.test.ts'));comp=sorted(p.stem.removesuffix('.test') for p in (ROOT/'dist/tests').glob('*.test.js'));missing=sorted(set(src)-set(comp));extra=sorted(set(comp)-set(src))
 if missing or extra:raise RuntimeError(f'test_inventory_mismatch:{missing}:{extra}')
 return src,missing,extra
def build_incremental():
 t=time.perf_counter();p=subprocess.run(['npm','run','build:incremental:v32.6'],cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env={**os.environ,'NODE_OPTIONS':''});row={'status':'passed' if p.returncode==0 else'failed','durationMs':round((time.perf_counter()-t)*1000,3),'exitCode':p.returncode,'outputTail':p.stdout[-4000:]}
 if p.returncode:print(p.stdout[-12000:],file=sys.stderr);raise SystemExit(p.returncode)
 return row
def load_profile(names):
 rows=[]
 for p in [PROFILE_PATH,FALLBACK_PROFILE,ROOT/'evidence/generated/V32_6_TEST_FILE_PROFILE.json']:
  if p.exists():
   try:rows=json.loads(p.read_text()).get('rows',[]);break
   except Exception:pass
 values={Path(r['file']).stem.removesuffix('.test'):float(r.get('executionWallMs',r.get('wallMs',350))) for r in rows if isinstance(r,dict) and r.get('file')}
 return {n:values.get(n,350.0) for n in names}
def resources(name):
 out=[]
 for pattern,items in CONFIG['resourceRules'].items():
  if pattern in name:out.extend(items)
 return sorted(set(out))
def tier(name,duration):
 if any(p in name for p in CONFIG['qualificationPatterns']):return'qualification'
 if any(p in name for p in CONFIG['deepPatterns']) or duration>=CONFIG['coreMaximumHistoricalDurationMs']:return'deep'
 return'core' if duration>=250 else'quick'
def relevant():
 roots=[ROOT/x for x in ['package.json','package-lock.json','tsconfig.json','CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','README.md','CLAUDE_HANDOFF_v32_6.md']];patterns=['docs/**/*','config/**/*','src/**/*.ts','tests/**/*.ts','scripts/**/*','e2e/**/*','governance-state/**/*.json','infra/**/*','isolation/**/*','schemas/**/*','.github/workflows/**/*'];files=[*roots]
 for pat in patterns:files.extend(ROOT.glob(pat))
 return sorted({p for p in files if p.is_file() and'__pycache__'not in p.parts})
def resolve_import(source,spec):
 if not spec.startswith('.'):return None
 c=(source.parent/spec).resolve();c=c.with_suffix('.ts') if c.suffix=='.js' else c
 for v in [c,c.with_suffix('.ts'),c/'index.ts']:
  if v.exists() and ROOT in v.parents:return v
 return None
def dependency_graph():
 direct={}
 sources=[*ROOT.glob('src/**/*.ts'),*ROOT.glob('tests/**/*.ts')]
 all_cli=sorted(rel(p) for p in ROOT.glob('src/cli/*.ts'))
 for path in sources:
  text=path.read_text(errors='replace');deps=set()
  for spec in IMPORT_RE.findall(text):
   d=resolve_import(path,spec)
   if d:deps.add(d)
  for raw in PATH_RE.findall(text):
   normalized=raw.removeprefix('dist/').replace('.js','.ts');candidate=ROOT/normalized
   if candidate.exists():deps.add(candidate.resolve())
  if 'dist/src/cli/' in text or 'src/cli/' in text:
   for c in all_cli:deps.add((ROOT/c).resolve())
  direct[path.resolve()]=deps
 result={}
 for test in sorted(ROOT.glob('tests/*.test.ts')):
  seen=set();stack=[test.resolve()]
  while stack:
   cur=stack.pop()
   if cur in seen:continue
   seen.add(cur);stack.extend(direct.get(cur,set()))
  result[test.stem.removesuffix('.test')]=sorted(rel(x) for x in seen)
 return result
def impact_selection(names):
 current={rel(p):sha(p) for p in relevant() if p.exists()}
 try:previous=json.loads(IMPACT_STATE.read_text()).get('hashes',{})
 except Exception:previous={}
 changed=sorted({*current,*previous}-{p for p in current if current.get(p)==previous.get(p)});graph=dependency_graph();mandatory=set(CONFIG['mandatorySentinels'])&set(names)
 if not previous:return names,{'mode':'core-fallback','changedFiles':changed,'reasons':['no_prior_impact_baseline']}
 if any(p in set(CONFIG['globalInvalidators']) for p in changed):return names,{'mode':'core-fallback','changedFiles':changed,'reasons':['global_invalidator']}
 known=set().union(*(set(x) for x in graph.values()))|set(current);unknown=[p for p in changed if p not in known and not p.startswith(('docs/','evidence/'))]
 if unknown:return names,{'mode':'core-fallback','changedFiles':changed,'unknownFiles':unknown,'reasons':['unknown_change']}
 selected=mandatory|{name for name,deps in graph.items() if set(changed)&set(deps)};return sorted(selected),{'mode':'impacted' if selected else'cache-hit','changedFiles':changed,'reasons':['dependency_intersection','mandatory_sentinels']}
def lpt_shards(names,durations,count_shards):
 if count_shards==1:
  rs=set().union(*(set(resources(n)) for n in names)) if names else set()
  return[{'index':0,'names':sorted(names),'estimatedMs':round(sum(durations[n] for n in names),3),'resources':sorted(rs)}]
 exclusive=[n for n in names if 'exclusive-shard' in resources(n)]
 regular=[n for n in names if n not in exclusive]
 if len(exclusive)>=count_shards:
  raise ValueError('exclusive_shards_exhaust_capacity')
 shards=[{'index':i,'names':[],'estimatedMs':0.0,'resources':set()} for i in range(count_shards)]
 for i,name in enumerate(sorted(exclusive)):
  rs=set(resources(name));shards[i]['names'].append(name);shards[i]['estimatedMs']+=durations[name];shards[i]['resources']|=rs
 targets=shards[len(exclusive):]
 for name in sorted(regular,key=lambda n:(-durations[n],n)):
  rs=set(resources(name));compatible=[s for s in targets if not rs&s['resources']];target=min(compatible or targets,key=lambda s:(s['estimatedMs'],s['index']));target['names'].append(name);target['estimatedMs']+=durations[name];target['resources']|=rs
 return[{'index':s['index'],'names':sorted(s['names']),'estimatedMs':round(s['estimatedMs'],3),'resources':sorted(s['resources'])}for s in shards]

def terminate(p):
 if p.poll()is not None:return
 try:os.killpg(p.pid,signal.SIGTERM)
 except ProcessLookupError:return
 try:p.wait(timeout=3)
 except subprocess.TimeoutExpired:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  p.wait(timeout=3)
def tap_complete(text):
 tests=count(text,'tests');passed=count(text,'pass');failed=count(text,'fail');complete=tests>0 and passed+failed==tests and re.search(r'^# duration_ms [0-9.]+$',text,re.M)is not None;return complete,tests,passed,failed
def execute(names,mode,concurrency,timeout_s,label='',functional_repeat=False):
 files=[f'dist/tests/{n}.test.js'for n in names];suffix=f'_{label}'if label else'';log=OUT/f'V32_6_{mode.upper()}{suffix}_TESTS.tap.log';started=time.perf_counter();timed=False;reaped=False;lifecycle=False;force_exit=mode in('quick','core','qualification')or functional_repeat;cmd=['node','--test',f'--test-concurrency={concurrency}','--test-reporter=tap',*(['--test-force-exit']if force_exit else[]),*files]
 with log.open('w')as stream:p=subprocess.Popen(cmd,cwd=ROOT,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':'','V32_6_TEST_MODE':mode},stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
 deadline=time.monotonic()+timeout_s;complete_at=None
 while True:
  text=log.read_text(errors='replace')if log.exists()else'';complete,tests,passed,failed=tap_complete(text);now=time.monotonic()
  if complete and complete_at is None:complete_at=now
  if p.poll()is not None:break
  if complete_at is not None and now-complete_at>=1.5:
   if mode=='full'and not functional_repeat:lifecycle=True
   else:reaped=True
   terminate(p);break
  if now>=deadline:timed=True;terminate(p);break
  time.sleep(.1)
 text=log.read_text(errors='replace');complete,tests,passed,failed=tap_complete(text);clean=p.returncode==0 and not timed and not lifecycle;accepted=reaped and complete and not timed and(mode!='full'or functional_repeat);status='passed'if complete and failed==0 and(clean or accepted)else'failed'
 return{'status':status,'command':cmd,'testFiles':len(files),'tests':tests,'passed':passed,'failed':failed,'wallDurationMs':round((time.perf_counter()-started)*1000,3),'exitCode':p.returncode,'timedOut':timed,'forceExitEnabled':force_exit,'functionalRepeat':functional_repeat,'tapCompleted':complete,'reapedAfterCompleteTap':reaped,'lifecycleLeakDetected':lifecycle,'logPath':rel(log)}
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--mode',choices=['quick','core','full','qualification'],default='core');ap.add_argument('--no-build',action='store_true');ap.add_argument('--plan-only',action='store_true');ap.add_argument('--shard-index',type=int);ap.add_argument('--shard-count',type=int,default=1);ap.add_argument('--concurrency',type=int);ap.add_argument('--functional-repeat',action='store_true');a=ap.parse_args()
 if a.functional_repeat and a.mode!='full':raise SystemExit('functional_repeat_requires_full_mode')
 build={'status':'skipped','durationMs':0.0}if a.no_build else build_incremental();names,missing,extra=inventory();identity=ctx.execution_identity();durations=load_profile(names);entries=[{'name':n,'durationMs':durations[n],'tier':tier(n,durations[n]),'resources':resources(n)}for n in names];impact={}
 if a.mode=='full':selected=names
 elif a.mode=='qualification':selected=[x['name']for x in entries if x['tier']=='qualification']
 elif a.mode=='core':selected=[x['name']for x in entries if x['tier']in('quick','core')]
 else:
  core=[x['name']for x in entries if x['tier']in('quick','core')];selected,impact=impact_selection(core);mandatory_all=set(CONFIG['mandatorySentinels'])&set(names);selected=sorted(set(selected)|mandatory_all);impact={**impact,'mandatorySentinelsRequired':sorted(mandatory_all),'mandatorySentinelsSelected':sorted(mandatory_all&set(selected))}
 shards=lpt_shards(selected,durations,a.shard_count)
 if a.shard_index is not None:
  if a.shard_index<0 or a.shard_index>=a.shard_count:raise SystemExit('invalid_shard_index')
  selected=shards[a.shard_index]['names']
 concurrency=max(1,min(a.concurrency or int(CONFIG['defaultConcurrency']),int(CONFIG['maximumConcurrency'])));plan={'version':'32.6.1','mode':a.mode,'runId':OUT.name,**identity,'shardIndex':a.shard_index,'shardCount':a.shard_count,'generatedAt':utc(),'inventory':{'sourceTestFiles':len(names),'compiledTestFiles':len(names),'missing':missing,'extra':extra},'selectedTestFiles':selected,'selectedCount':len(selected),'estimatedSerialMs':round(sum(durations[n]for n in selected),3),'tierCounts':{t:sum(1 for x in entries if x['tier']==t)for t in['quick','core','deep','qualification']},'shards':shards,'impact':impact,'build':build,'concurrency':concurrency,'classification':'developer-feedback'if a.mode in('quick','core')else'authoritative-test-execution'}
 report={**plan,'status':'planned'}if a.plan_only else{**plan,**execute(selected,a.mode,concurrency,120 if a.mode!='full' else 240,f'SHARD_{a.shard_index+1}_OF_{a.shard_count}'if a.shard_index is not None else'',a.functional_repeat)}
 if not a.plan_only and report['status']=='passed'and a.mode in('core','full'):ctx.atomic_write_json(IMPACT_STATE,{'version':'32.6.1','authority':a.mode,'sourceDigest':identity['sourceDigest'],'testManifestDigest':identity['testManifestDigest'],'hashes':{rel(p):sha(p)for p in relevant()if p.exists()},'updatedAt':utc()})
 suffix=f'_SHARD_{a.shard_index+1}_OF_{a.shard_count}'if a.shard_index is not None else'';ctx.atomic_write_json(OUT/f'V32_6_{a.mode.upper()}{suffix}_TEST_RESULTS.json',report);print(json.dumps({k:report[k]for k in['status','mode','selectedCount','tests','passed','failed','wallDurationMs','build']if k in report},indent=2))
 if report.get('status')=='failed':print((OUT/f'V32_6_{a.mode.upper()}{suffix}_TESTS.tap.log').read_text(errors='replace')[-12000:],file=sys.stderr);return 1
 return 0
if __name__=='__main__':raise SystemExit(main())
