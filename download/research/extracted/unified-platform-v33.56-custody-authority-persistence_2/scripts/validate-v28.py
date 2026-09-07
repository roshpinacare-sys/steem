#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, shutil, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated'
QUAR=ROOT/'evidence/quarantine'
STATE=OUT/'.v28-validation-state.json'
STAGES={
 'build':['npm','run','build:clean:v28'],
 'tests':['python3','scripts/run-tests-v28-parallel.py'],
 'coverage':['node','scripts/run-coverage-v28.mjs'],
 'quality':['node','scripts/test-quality-audit-v28.mjs'],
 'architecture':['node','scripts/architecture-validation-v28.mjs'],
 'branch-mutation':['python3','scripts/run-branch-mutation-v28.py'],
}
REQUIRED_REPORTS={
 'tests':'V28_TEST_RESULTS.json','coverage':'V28_COVERAGE_REPORT.json',
 'quality':'V28_TEST_QUALITY_AUDIT.json','architecture':'V28_ARCHITECTURE_INTEGRITY.json',
 'branch-mutation':'V28_BRANCH_MUTATION_RESULTS.json',
}

def utc(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def canonical(obj): return json.dumps(obj,sort_keys=True,separators=(',',':')).encode()
def source_digest():
    h=hashlib.sha256()
    include=['package.json','package-lock.json','tsconfig.json','src','tests','scripts','governance-state','infra']
    for item in include:
        p=ROOT/item
        files=[p] if p.is_file() else sorted(x for x in p.rglob('*') if x.is_file())
        for f in files:
            rel=f.relative_to(ROOT).as_posix()
            if rel.startswith(('evidence/','dist/','node_modules/','.cache/')) or '__pycache__' in rel: continue
            h.update(rel.encode()+b'\0'+f.read_bytes()+b'\0')
    return h.hexdigest()
def load_state():
    if not STATE.exists(): raise SystemExit('validation_not_initialized')
    state=json.loads(STATE.read_text())
    if state['sourceDigest']!=source_digest(): raise SystemExit('validation_source_digest_changed')
    return state
def save_state(state):
    tmp=STATE.with_suffix('.tmp'); tmp.write_text(json.dumps(state,indent=2)+'\n'); os.replace(tmp,STATE)
def initialize():
    OUT.mkdir(parents=True,exist_ok=True); QUAR.mkdir(parents=True,exist_ok=True)
    old=list(OUT.iterdir())
    if old:
        target=QUAR/f'v28-{int(time.time())}'; target.mkdir(parents=True)
        for item in old: shutil.move(str(item),target/item.name)
    OUT.mkdir(parents=True,exist_ok=True)
    state={'version':'28.0','status':'IN_PROGRESS','startedAt':utc(),'sourceDigest':source_digest(),'checks':{}}
    save_state(state); print(json.dumps({'status':'initialized','sourceDigest':state['sourceDigest']}))
def run_stage(name):
    if name not in STAGES: raise SystemExit(f'unknown_stage:{name}')
    state=load_state(); start=time.perf_counter()
    log=OUT/f'v28-{name}.log'
    with log.open('w') as handle:
        p=subprocess.run(STAGES[name],cwd=ROOT,text=True,stdout=handle,stderr=subprocess.STDOUT,env={**os.environ,'NODE_OPTIONS':'','NODE_ENV':'test'})
    row={'name':name,'command':STAGES[name],'exitCode':p.returncode,'durationMs':round((time.perf_counter()-start)*1000,3),'status':'passed' if p.returncode==0 else 'failed','log':str(log.relative_to(ROOT)),'sourceDigest':state['sourceDigest']}
    state['checks'][name]=row; save_state(state); print(json.dumps(row),flush=True)
    if p.returncode!=0:
        print(log.read_text()[-12000:],file=sys.stderr); raise SystemExit(p.returncode or 1)
    report=REQUIRED_REPORTS.get(name)
    if report and not (OUT/report).exists(): raise SystemExit(f'stage_report_missing:{report}')
def finalize():
    state=load_state(); missing=[x for x in STAGES if state['checks'].get(x,{}).get('status')!='passed']
    if missing: raise SystemExit('validation_stages_missing:'+','.join(missing))
    def load(name): return json.loads((OUT/name).read_text())
    tests=load('V28_TEST_RESULTS.json'); coverage=load('V28_COVERAGE_REPORT.json'); quality=load('V28_TEST_QUALITY_AUDIT.json'); architecture=load('V28_ARCHITECTURE_INTEGRITY.json'); mutation=load('V28_BRANCH_MUTATION_RESULTS.json')
    assertions={
      'allChecksPassed':all(c['status']=='passed' for c in state['checks'].values()),
      'testsPassed':tests['status']=='passed' and tests['totals']['tests']==tests['totals']['passed'] and tests['totals']['failed']==0,
      'branchThreshold':coverage['current']['branchPercent']>=96,
      'lineThreshold':coverage['current']['linePercent']>=99.5,
      'functionThreshold':coverage['current']['functionPercent']>=98.5,
      'qualityPassed':quality['status']=='passed',
      'architecturePassed':architecture['status']=='PASS' and architecture['metrics']['sourceCycleCount']==0 and architecture['metrics']['untestedSourceCount']==0,
      'mutationsAuthentic':mutation['status']=='passed' and mutation['mutantsKilledAuthentically']==mutation['mutantsSpecified'] and mutation['survivors']==0 and mutation['invalidKills']==0,
    }
    status='passed' if all(assertions.values()) else 'failed'
    ordered=[state['checks'][x] for x in STAGES]
    report={'version':'28.0','status':status,'classification':'branch-coverage-and-security-closure-validation','startedAt':state['startedAt'],'finishedAt':utc(),'sourceDigest':state['sourceDigest'],'checks':ordered,'assertions':assertions,'results':{'tests':tests['totals'],'coverage':coverage['current'],'deltaVsV27':coverage['deltaVsV27'],'testQuality':{'files':quality['filesAudited'],'tests':quality['testsDeclared'],'assertions':quality['assertCalls'],'criticalOrHighIssues':quality['criticalOrHighIssues'],'mediumIssues':quality['mediumIssues']},'architecture':architecture['metrics'],'branchMutations':{k:mutation[k] for k in ('mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')}},'limitations':['Node in-process coverage excludes subprocess, browser, namespace and WebAssembly worker percentages, although those paths remain in correctness lanes.','Targeted v28 mutation supplements rather than replaces the broader v27 mutation portfolio.','PostgreSQL multi-host, HSM/KMS and external penetration qualification remain outside this local branch-closure gate.']}
    (OUT/'V28_FINAL_VALIDATION.json').write_text(json.dumps(report,indent=2)+'\n')
    state['status']=status.upper(); state['finishedAt']=report['finishedAt']; save_state(state)
    print(json.dumps({'status':status,'assertions':assertions,'results':report['results']},indent=2)); raise SystemExit(0 if status=='passed' else 1)
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--initialize',action='store_true'); ap.add_argument('--stage',choices=list(STAGES)); ap.add_argument('--finalize',action='store_true'); args=ap.parse_args()
    if args.initialize: initialize(); return
    if args.stage: run_stage(args.stage); return
    if args.finalize: finalize(); return
    initialize()
    for stage in STAGES: run_stage(stage)
    finalize()
if __name__=='__main__': main()
