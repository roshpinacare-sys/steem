#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'.cache/v24-test-impact-state.json'
OUT=ROOT/'evidence/generated/V24_IMPACT_TEST_RESULTS.json'
MANDATORY=['tests/governance-consistency.test.ts','tests/test-execution-provenance.test.ts','tests/operations-optimization-v24.test.ts']
GLOBAL={'package.json','package-lock.json','tsconfig.json','tests/helpers.ts'}
IMPORT_RE=re.compile(r"(?:from\s+|import\s*\()\s*['\"]([^'\"]+)['\"]")

def sha(path:Path)->str:
 h=hashlib.sha256(); h.update(path.read_bytes()); return h.hexdigest()

def relevant()->list[Path]:
 return sorted([*ROOT.glob('src/**/*.ts'),*ROOT.glob('tests/**/*.ts'),ROOT/'package.json',ROOT/'package-lock.json',ROOT/'tsconfig.json'])

def rel(path:Path)->str:return path.relative_to(ROOT).as_posix()

def resolve_import(source:Path,spec:str)->Path|None:
 if not spec.startswith('.'): return None
 candidate=(source.parent/spec).resolve()
 if candidate.suffix==Path('.js').suffix: candidate=candidate.with_suffix('.ts')
 for value in [candidate,candidate.with_suffix('.ts'),candidate/'index.ts']:
  if value.exists() and ROOT in value.parents:return value
 return None

def graph()->dict[str,list[str]]:
 direct:dict[Path,set[Path]]={}
 for path in [*ROOT.glob('src/**/*.ts'),*ROOT.glob('tests/**/*.ts')]:
  deps=set()
  for spec in IMPORT_RE.findall(path.read_text(errors='replace')):
   dep=resolve_import(path,spec)
   if dep is not None: deps.add(dep)
  direct[path.resolve()]=deps
 result={}
 for test in sorted(ROOT.glob('tests/*.test.ts')):
  seen=set(); stack=[test.resolve()]
  while stack:
   current=stack.pop()
   if current in seen:continue
   seen.add(current); stack.extend(direct.get(current,set()))
  result[rel(test)]=sorted(rel(item) for item in seen)
 return result

def count(text:str,label:str)->int:
 m=re.findall(rf'^# {re.escape(label)} (\d+)$',text,re.M); return int(m[-1]) if m else 0

def main()->int:
 parser=argparse.ArgumentParser(); parser.add_argument('--plan-only',action='store_true'); args=parser.parse_args()
 current={rel(p):sha(p) for p in relevant() if p.exists()}
 try: previous=json.loads(CACHE.read_text()).get('hashes',{})
 except Exception: previous={}
 changed=sorted({*current,*previous}-{p for p in current if current.get(p)==previous.get(p)})
 tests=graph(); reasons=[]; unknown=[]
 if not previous:
  mode='full'; selected=sorted(tests); reasons=['no_prior_impact_baseline']
 elif any(path in GLOBAL for path in changed):
  mode='full'; selected=sorted(tests); reasons=[f'global_invalidator:{path}' for path in changed if path in GLOBAL]
 else:
  known=set().union(*(set(deps) for deps in tests.values()))|set(tests)
  unknown=[path for path in changed if path not in known and not path.startswith(('docs/','evidence/','.cache/'))]
  if unknown:
   mode='full'; selected=sorted(tests); reasons=['unknown_change_requires_full_suite']
  else:
   selected=sorted(set(MANDATORY)|{test for test,deps in tests.items() if set(changed)&set(deps)})
   mode='impacted' if selected else 'none'; reasons=['dependency_intersection','mandatory_sentinels_added']
 compiled=[f"dist/{Path(path).with_suffix('.js').as_posix()}" for path in selected]
 started=time.perf_counter(); rc=0; output=''; tests_run=passed=failed=0
 if not args.plan_only and compiled:
  result=subprocess.run(['node','--test',f'--test-concurrency={min(3,len(compiled))}','--test-reporter=tap',*compiled],cwd=ROOT,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=90)
  rc=result.returncode; output=result.stdout; tests_run=count(output,'tests'); passed=count(output,'pass'); failed=count(output,'fail')
  if rc==0 and tests_run==passed and failed==0:CACHE.parent.mkdir(parents=True,exist_ok=True); CACHE.write_text(json.dumps({'version':'24.0','hashes':current},indent=2)+'\n')
 elif not args.plan_only:
  CACHE.parent.mkdir(parents=True,exist_ok=True); CACHE.write_text(json.dumps({'version':'24.0','hashes':current},indent=2)+'\n')
 status='planned' if args.plan_only else ('passed' if rc==0 and (not compiled or tests_run==passed) and failed==0 else 'failed')
 report={'version':'24.0','status':status,'mode':mode,'changedFiles':changed,'unknownFiles':unknown,'selectedTestFiles':selected,'selectedCount':len(selected),'fullSuiteTestFiles':len(tests),'executedTests':tests_run,'passed':passed,'failed':failed,'exitCode':rc,'durationMs':round((time.perf_counter()-started)*1000,3),'reasons':reasons,'classification':'developer-feedback-optimization-not-authoritative-release-validation','safety':{'unknownChangesForceFullSuite':True,'globalConfigurationForcesFullSuite':True,'mandatorySentinels':MANDATORY,'fullV24ValidationStillRequiredForRelease':True},'outputTail':output[-4000:]}
 OUT.parent.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:report[k] for k in ['status','mode','selectedCount','executedTests','durationMs','reasons']},indent=2))
 return 0 if status in ('passed','planned') else 1
if __name__=='__main__':raise SystemExit(main())
