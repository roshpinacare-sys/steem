#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, shutil, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'evidence/generated'; QUAR=ROOT/'evidence/quarantine'; STATE=OUT/'.v29-validation-state.json'
STAGES={
 'build':(['npm','run','build:clean:v29'],{0}),
 'tests':(['python3','scripts/run-tests-v29-parallel.py'],{0}),
 'coverage':(['node','scripts/run-coverage-v29.mjs'],{0}),
 'quality':(['node','scripts/test-quality-audit-v29.mjs'],{0}),
 'architecture':(['node','scripts/architecture-validation-v29.mjs'],{0}),
 'automation-mutation':(['python3','scripts/run-automation-mutation-v29.py'],{0}),
 'value-proof':(['node','scripts/value-automation-proof-v29.mjs'],{0}),
 'integration-closure':(['node','scripts/integration-closure-v29.mjs'],{0}),
 'supply-chain':(['node','scripts/supply-chain-report-v29.mjs'],{0}),
 'incomplete-audit':(['node','scripts/incomplete-code-audit-v29.mjs'],{0}),
 'dr':(['node','scripts/local-dr-rehearsal-v29.mjs'],{0}),
 'pilot-protocol':(['node','scripts/generate-human-pilot-v29.mjs'],{0}),
 'operations':(['node','scripts/generate-operations-report-v29.mjs'],{0}),
 'browser':(['python3','e2e/test_breakthrough_pilot_v29.py'],{0}),
 'isolation':(['bash','scripts/run-linux-isolation-v29.sh'],{0}),
 'postgres':(['node','scripts/qualify-postgres-v29.mjs'],{0,2}),
 'stability':(['python3','scripts/stability-v29.py'],{0}),
 'qualification':(['node','scripts/qualification-matrix-v29.mjs'],{0}),
}
REPORTS={
 'tests':'V29_TEST_RESULTS.json','coverage':'V29_COVERAGE_REPORT.json','quality':'V29_TEST_QUALITY_AUDIT.json','architecture':'V29_ARCHITECTURE_INTEGRITY.json','automation-mutation':'V29_AUTOMATION_MUTATION_RESULTS.json','value-proof':'V29_VALUE_AUTOMATION_PROOF.json','integration-closure':'V29_INTEGRATION_CLOSURE.json','supply-chain':'V29_SUPPLY_CHAIN_REPORT.json','incomplete-audit':'V29_INCOMPLETE_CODE_AUDIT.json','dr':'V29_LOCAL_DR_REHEARSAL.json','pilot-protocol':'V29_HUMAN_PILOT_PROTOCOL.json','operations':'V29_OPERATIONAL_ACTION_CENTER.json','browser':'V29_BROWSER_E2E.json','isolation':'V29_LINUX_ISOLATION.json','postgres':'V29_POSTGRES_QUALIFICATION.json','stability':'V29_STABILITY_REPORT.json','qualification':'V29_QUALIFICATION_MATRIX.json'}
def utc(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def source_digest():
 h=hashlib.sha256()
 for item in ['package.json','package-lock.json','tsconfig.json','src','tests','scripts','e2e','governance-state','infra','isolation']:
  p=ROOT/item
  if not p.exists(): continue
  files=[p] if p.is_file() else sorted(x for x in p.rglob('*') if x.is_file())
  for f in files:
   rel=f.relative_to(ROOT).as_posix()
   if rel.startswith(('evidence/','dist/','node_modules/','.cache/')) or '__pycache__' in rel: continue
   h.update(rel.encode()+b'\0'+f.read_bytes()+b'\0')
 return h.hexdigest()
def save(state):
 OUT.mkdir(parents=True,exist_ok=True); tmp=STATE.with_suffix('.tmp'); tmp.write_text(json.dumps(state,indent=2)+'\n'); os.replace(tmp,STATE)
def load():
 if not STATE.exists(): raise SystemExit('validation_not_initialized')
 state=json.loads(STATE.read_text())
 if state['sourceDigest']!=source_digest(): raise SystemExit('validation_source_digest_changed')
 return state
def initialize():
 OUT.mkdir(parents=True,exist_ok=True); QUAR.mkdir(parents=True,exist_ok=True)
 old=list(OUT.iterdir())
 if old:
  q=QUAR/f'v29-{int(time.time())}'; q.mkdir(parents=True)
  for item in old: shutil.move(str(item),q/item.name)
 OUT.mkdir(parents=True,exist_ok=True); state={'version':'29.0','status':'IN_PROGRESS','startedAt':utc(),'sourceDigest':source_digest(),'checks':{}}; save(state); print(json.dumps({'status':'initialized','sourceDigest':state['sourceDigest']}),flush=True)
def stage(name):
 if name not in STAGES: raise SystemExit(f'unknown_stage:{name}')
 state=load(); cmd,accepted=STAGES[name]; start=time.perf_counter(); log=OUT/f'v29-{name}.log'
 with log.open('w') as handle: p=subprocess.run(cmd,cwd=ROOT,text=True,stdout=handle,stderr=subprocess.STDOUT,env={**os.environ,'NODE_OPTIONS':'','NODE_ENV':'test'})
 status='passed' if p.returncode in accepted else 'failed'; row={'name':name,'command':cmd,'acceptedExitCodes':sorted(accepted),'exitCode':p.returncode,'durationMs':round((time.perf_counter()-start)*1000,3),'status':status,'log':str(log.relative_to(ROOT)),'sourceDigest':state['sourceDigest']}; state['checks'][name]=row; save(state); print(json.dumps(row),flush=True)
 if status!='passed': print(log.read_text()[-15000:],file=sys.stderr); raise SystemExit(p.returncode or 1)
 report=REPORTS.get(name)
 if report and not (OUT/report).exists(): raise SystemExit(f'stage_report_missing:{report}')
def read(name): return json.loads((OUT/name).read_text())
def finalize():
 state=load(); missing=[name for name in STAGES if state['checks'].get(name,{}).get('status')!='passed']
 if missing: raise SystemExit('validation_stages_missing:'+','.join(missing))
 tests=read('V29_TEST_RESULTS.json'); coverage=read('V29_COVERAGE_REPORT.json'); quality=read('V29_TEST_QUALITY_AUDIT.json'); architecture=read('V29_ARCHITECTURE_INTEGRITY.json'); mutation=read('V29_AUTOMATION_MUTATION_RESULTS.json'); value=read('V29_VALUE_AUTOMATION_PROOF.json'); integration=read('V29_INTEGRATION_CLOSURE.json'); supply=read('V29_SUPPLY_CHAIN_REPORT.json'); incomplete=read('V29_INCOMPLETE_CODE_AUDIT.json'); dr=read('V29_LOCAL_DR_REHEARSAL.json'); browser=read('V29_BROWSER_E2E.json'); isolation=read('V29_LINUX_ISOLATION.json'); postgres=read('V29_POSTGRES_QUALIFICATION.json'); stability=read('V29_STABILITY_REPORT.json'); qualification=read('V29_QUALIFICATION_MATRIX.json'); operations=read('V29_OPERATIONAL_ACTION_CENTER.json')
 assertions={
  'allStagesPassed':all(x['status']=='passed' for x in state['checks'].values()),
  'testsPassed':tests['status']=='passed' and tests['totals']['tests']==tests['totals']['passed'] and tests['totals']['failed']==0 and tests['totals']['tests']>=476,
  'coverageFloor':coverage['status']=='passed' and coverage['current']['linePercent']>=99 and coverage['current']['branchPercent']>=96 and coverage['current']['functionPercent']>=98.5,
  'qualityPassed':quality['status']=='passed' and quality['criticalOrHighIssues']==0 and quality['mediumIssues']==0,
  'architectureClosed':architecture['status']=='PASS' and architecture['metrics']['sourceCycleCount']==0 and architecture['metrics']['untestedSourceCount']==0 and architecture['metrics']['closedCapabilityPathCount']==architecture['metrics']['capabilityPathCount'],
  'mutationsAuthentic':mutation['status']=='passed' and mutation['mutantsKilledAuthentically']==mutation['mutantsSpecified'] and mutation['survivors']==0 and mutation['invalidKills']==0,
  'valueProofBounded':value['status']=='passed' and value['results']['externalEffectsExecuted']==0 and value['results']['restartReplayModelCalls']==0 and value['valueEvidence']['claimedStatus']=='PROMISING_NOT_HUMAN_VALIDATED',
  'integrationClosed':integration['status']=='passed' and integration['edgesClosed']==integration['edgesSpecified'],
  'supplyChainPassed':supply['status'] in ['passed','passed-with-advisory-environment-blocked'],
  'incompleteAuditPassed':incomplete['status']=='passed',
  'drPassed':dr['status']=='passed-local-rehearsal',
  'browserPassed':browser['status']=='passed',
  'isolationResearchProof':isolation['status']=='passed-single-host-research-proof',
  'postgresHonest':postgres['status'] in ['environment-blocked','implemented-and-exercised-single-database'],
  'stabilityPassed':stability['status']=='passed' and stability['flakeCount']==0,
  'operationsFailClosed':operations['status']=='passed' and operations['automation']['externalEffectsExecuted']==0,
  'qualificationIntegratedPilot':qualification['status']=='passed-integrated-pilot' and qualification['productionPromotion']=='blocked',
 }
 status='passed' if all(assertions.values()) else 'failed'
 report={'version':'29.0','status':status,'classification':'governed-automation-integration-and-value-realization-validation','startedAt':state['startedAt'],'finishedAt':utc(),'sourceDigest':state['sourceDigest'],'checks':[state['checks'][x] for x in STAGES],'assertions':assertions,'results':{'tests':tests['totals'],'coverage':coverage['current'],'testQuality':{'files':quality['filesAudited'],'tests':quality['testsDeclared'],'assertions':quality['assertCalls'],'criticalOrHighIssues':quality['criticalOrHighIssues'],'mediumIssues':quality['mediumIssues']},'architecture':architecture['metrics'],'mutations':{k:mutation[k] for k in ('mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},'automationValue':{'scenarios':value['proofScope']['scenarios'],'actionsProposed':value['results']['totalActionsProposed'],'externalEffectsExecuted':value['results']['externalEffectsExecuted'],'restartReplayModelCalls':value['results']['restartReplayModelCalls'],'claimBoundary':value['valueEvidence']['claimedStatus']},'integration':{'edgesSpecified':integration['edgesSpecified'],'edgesClosed':integration['edgesClosed']},'stability':stability['statistics'],'readiness':qualification['readiness'],'productionPromotion':qualification['productionPromotion']},'limitations':['Modeled workflow reductions are not human-pilot measurements.','Local execution, browser, DR and isolation proof do not qualify multi-host production infrastructure.','PostgreSQL, KMS/HSM, external security, licensing and human pilot remain blocked gates.']}
 (OUT/'V29_FINAL_VALIDATION.json').write_text(json.dumps(report,indent=2)+'\n'); state['status']=status.upper(); state['finishedAt']=report['finishedAt']; save(state); print(json.dumps({'status':status,'assertions':assertions,'results':report['results']},indent=2)); raise SystemExit(0 if status=='passed' else 1)
def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--initialize',action='store_true'); ap.add_argument('--stage',choices=list(STAGES)); ap.add_argument('--finalize',action='store_true'); a=ap.parse_args()
 if a.initialize: initialize(); return
 if a.stage: stage(a.stage); return
 if a.finalize: finalize(); return
 initialize()
 for name in STAGES: stage(name)
 finalize()
if __name__=='__main__': main()
