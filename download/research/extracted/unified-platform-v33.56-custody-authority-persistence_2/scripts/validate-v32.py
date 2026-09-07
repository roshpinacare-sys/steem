#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, shutil, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'evidence/generated'; QUAR=ROOT/'evidence/quarantine'; STATE=OUT/'.v32-validation-state.json'
STAGES={
 'build':(['npm','run','build:clean:v32'],{0}),
 'prepare-isolation':(['bash','scripts/prepare-linux-probes-v32.sh'],{0}),
 'tests':(['python3','scripts/run-tests-v32-parallel.py'],{0}),
 'coverage':(['node','scripts/run-coverage-v32.mjs'],{0}),
 'quality':(['node','scripts/test-quality-audit-v32.mjs'],{0}),
 'incomplete-audit':(['node','scripts/incomplete-code-audit-v32.mjs'],{0}),
 'architecture':(['node','scripts/architecture-validation-v32.mjs'],{0}),
 'credential-mutation':(['python3','scripts/run-credential-sovereignty-mutation-v32.py'],{0}),
 'credential-proof':(['node','scripts/credential-sovereignty-proof-v32.mjs'],{0}),
 'integration':(['node','scripts/integration-closure-v32.mjs'],{0}),
 'supply-chain':(['node','scripts/supply-chain-report-v32.mjs'],{0}),
 'dr':(['node','scripts/local-dr-rehearsal-v32.mjs'],{0}),
 'pilot':(['node','scripts/generate-human-pilot-v32.mjs'],{0}),
 'browser':(['python3','e2e/test_breakthrough_pilot_v32.py'],{0}),
 'isolation':(['bash','scripts/run-linux-isolation-v32.sh'],{0}),
 'postgres':(['node','scripts/qualify-postgres-v32.mjs'],{0,2}),
 'operations':(['node','scripts/generate-operations-report-v32.mjs'],{0}),
 'stability':(['python3','scripts/stability-v32.py'],{0}),
 'qualification':(['node','scripts/qualification-matrix-v32.mjs'],{0}),
}
REPORTS={
 'prepare-isolation':'V32_LINUX_PROBE_CACHE.json','tests':'V32_TEST_RESULTS.json','coverage':'V32_COVERAGE_REPORT.json','quality':'V32_TEST_QUALITY_AUDIT.json','incomplete-audit':'V32_INCOMPLETE_CODE_AUDIT.json','architecture':'V32_ARCHITECTURE_INTEGRITY.json','credential-mutation':'V32_CREDENTIAL_SOVEREIGNTY_MUTATION_RESULTS.json','credential-proof':'V32_CREDENTIAL_SOVEREIGNTY_PROOF.json','integration':'V32_INTEGRATION_CLOSURE.json','supply-chain':'V32_SUPPLY_CHAIN_REPORT.json','dr':'V32_LOCAL_DR_REHEARSAL.json','pilot':'V32_HUMAN_PILOT_PROTOCOL.json','browser':'V32_BROWSER_E2E.json','isolation':'V32_LINUX_ISOLATION.json','postgres':'V32_POSTGRES_QUALIFICATION.json','operations':'V32_OPERATIONAL_ACTION_CENTER.json','stability':'V32_STABILITY_REPORT.json','qualification':'V32_QUALIFICATION_MATRIX.json'}
def utc(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def source_digest():
 h=hashlib.sha256()
 for item in ['CLAUDE.md','MASTER_DIRECTIVE.md','PROGRAM_CHARTER.md','package.json','package-lock.json','tsconfig.json','src','tests','scripts','e2e','governance-state','infra','isolation','schemas','external-qualification','docs']:
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
 state=json.loads(STATE.read_text()); current=source_digest()
 if state['sourceDigest']!=current: raise SystemExit(f'validation_source_digest_changed:{state["sourceDigest"]}:{current}')
 return state
def initialize():
 OUT.mkdir(parents=True,exist_ok=True); QUAR.mkdir(parents=True,exist_ok=True)
 old=list(OUT.iterdir())
 if old:
  q=QUAR/f'v32-{int(time.time())}'; q.mkdir(parents=True)
  for item in old: shutil.move(str(item),q/item.name)
 shutil.rmtree(ROOT/'dist',ignore_errors=True); shutil.rmtree(ROOT/'.cache',ignore_errors=True); OUT.mkdir(parents=True,exist_ok=True)
 state={'version':'32.5','status':'IN_PROGRESS','startedAt':utc(),'sourceDigest':source_digest(),'checks':{}}; save(state); print(json.dumps({'status':'initialized','sourceDigest':state['sourceDigest']}),flush=True)
def stage(name):
 state=load(); cmd,accepted=STAGES[name]; start=time.perf_counter(); log=OUT/f'v32-{name}.log'
 with log.open('w',encoding='utf8') as handle: p=subprocess.run(cmd,cwd=ROOT,text=True,stdout=handle,stderr=subprocess.STDOUT,env={**os.environ,'NODE_OPTIONS':'','NODE_ENV':'test'})
 status='passed' if p.returncode in accepted else 'failed'; row={'name':name,'command':cmd,'acceptedExitCodes':sorted(accepted),'exitCode':p.returncode,'durationMs':round((time.perf_counter()-start)*1000,3),'status':status,'log':str(log.relative_to(ROOT)),'sourceDigest':state['sourceDigest']}; state['checks'][name]=row; save(state); print(json.dumps(row),flush=True)
 if status!='passed': print(log.read_text(errors='replace')[-20000:],file=sys.stderr); raise SystemExit(p.returncode or 1)
 report=REPORTS.get(name)
 if report and not (OUT/report).exists(): raise SystemExit(f'stage_report_missing:{report}')
def read(n): return json.loads((OUT/n).read_text())
def finalize():
 state=load(); missing=[n for n in STAGES if state['checks'].get(n,{}).get('status')!='passed']
 if missing: raise SystemExit('validation_stages_missing:'+','.join(missing))
 tests=read('V32_TEST_RESULTS.json'); coverage=read('V32_COVERAGE_REPORT.json'); quality=read('V32_TEST_QUALITY_AUDIT.json'); incomplete=read('V32_INCOMPLETE_CODE_AUDIT.json'); architecture=read('V32_ARCHITECTURE_INTEGRITY.json'); mutation=read('V32_CREDENTIAL_SOVEREIGNTY_MUTATION_RESULTS.json'); proof=read('V32_CREDENTIAL_SOVEREIGNTY_PROOF.json'); integration=read('V32_INTEGRATION_CLOSURE.json'); supply=read('V32_SUPPLY_CHAIN_REPORT.json'); dr=read('V32_LOCAL_DR_REHEARSAL.json'); pilot=read('V32_HUMAN_PILOT_PROTOCOL.json'); browser=read('V32_BROWSER_E2E.json'); isolation=read('V32_LINUX_ISOLATION.json'); postgres=read('V32_POSTGRES_QUALIFICATION.json'); operations=read('V32_OPERATIONAL_ACTION_CENTER.json'); stability=read('V32_STABILITY_REPORT.json'); qualification=read('V32_QUALIFICATION_MATRIX.json')
 assertions={
  'allStagesPassed':all(x['status']=='passed' for x in state['checks'].values()),
  'testsPassed':tests['status']=='passed' and tests['totals']['tests']==tests['totals']['passed'] and tests['totals']['failed']==0 and tests['totals']['tests']>=584,
  'coverageFloor':coverage['status']=='passed' and coverage['current']['linePercent']>=99 and coverage['current']['branchPercent']>=96 and coverage['current']['functionPercent']>=98.5,
  'qualityPassed':quality['status']=='passed' and quality['criticalOrHighIssues']==0 and quality['mediumIssues']==0,
  'incompleteAuditPassed':incomplete['status']=='passed' and not incomplete['explicitIncompleteMarkers'] and not incomplete['packageScriptTargets']['missing'] and not incomplete['criticalIntegrationGaps'],
  'architectureClosed':architecture['status']=='PASS' and architecture['metrics']['sourceCycleCount']==0 and architecture['metrics']['untestedSourceCount']==0 and architecture['metrics']['closedCapabilityPathCount']==architecture['metrics']['capabilityPathCount'] and architecture['metrics']['capabilityPathCount']>=14,
  'mutationsAuthentic':mutation['status']=='passed' and mutation['mutantsKilledAuthentically']==mutation['mutantsSpecified'] and mutation['mutantsSpecified']>=16 and mutation['survivors']==0 and mutation['invalidKills']==0,
  'credentialProofPassed':proof['status']=='passed' and proof['results']['selfIssuanceRejected'] is True and proof['results']['sameCustodianThresholdRejected'] is True and proof['results']['offlineImportDigestMatches'] is True and proof['results']['independentAnchorRollbackDetected'] is True and proof['results']['historicalSignatureValidBeforeEffectiveRevocation'] is True and proof['results']['signatureBlockedAfterEffectiveRevocation'] is True and proof['results']['externalMutationsExecuted']==0,
  'integrationClosed':integration['status']=='passed' and integration['summary']['closed']==integration['summary']['edges'] and integration['summary']['edges']>=14,
  'supplyChainPassed':supply['status'] in ['passed','passed-with-advisory-environment-blocked'],
  'drPassed':dr['status']=='passed-local-rehearsal','pilotNotFabricated':pilot['status']=='protocol-ready-not-executed','browserPassed':browser['status']=='passed','isolationResearchProof':isolation['status']=='passed-single-host-research-proof','postgresHonest':postgres['status'] in ['environment-blocked','implemented-and-exercised-single-database'],
  'operationsFailClosed':operations['status']=='passed' and operations['promotion']=='blocked' and operations['credentialSovereignty']['externalMutationsExecuted']==0,
  'stabilityPassed':stability['status']=='passed' and stability['flakeCount']==0 and len(stability['runs'])==3,
  'qualificationIntegratedPilot':qualification['status']=='passed-integrated-pilot' and qualification['productionPromotion']=='blocked',
 }
 status='passed' if all(assertions.values()) else 'failed'
 report={'version':'32.5','status':status,'classification':'twenty-two-lens-holistic-assurance-core-validation','startedAt':state['startedAt'],'finishedAt':utc(),'sourceDigest':state['sourceDigest'],'checks':[state['checks'][x] for x in STAGES],'assertions':assertions,'results':{'tests':tests['totals'],'coverage':coverage['current'],'testQuality':{'files':quality['filesAudited'],'tests':quality['testsDeclared'],'assertions':quality['assertCalls'],'criticalOrHighIssues':quality['criticalOrHighIssues'],'mediumIssues':quality['mediumIssues']},'architecture':architecture['metrics'],'mutations':{k:mutation[k] for k in ('mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},'credentialSovereignty':proof['results'],'integration':integration['summary'],'stability':stability['statistics'],'readiness':qualification['readiness'],'productionPromotion':qualification['productionPromotion']},'limitations':proof['limitations']+[ 'PostgreSQL, KMS/HSM, independent security, distributed custodians, live provider and human value remain externally unqualified.' ]}
 (OUT/'V32_FINAL_VALIDATION.json').write_text(json.dumps(report,indent=2)+'\n'); state['status']=status.upper(); state['finishedAt']=report['finishedAt']; save(state); print(json.dumps({'status':status,'assertions':assertions,'results':report['results']},indent=2)); raise SystemExit(0 if status=='passed' else 1)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--initialize',action='store_true');ap.add_argument('--stage',choices=list(STAGES));ap.add_argument('--finalize',action='store_true');a=ap.parse_args()
 if a.initialize: initialize();return
 if a.stage: stage(a.stage);return
 if a.finalize: finalize();return
 initialize()
 for n in STAGES: stage(n)
 finalize()
if __name__=='__main__':main()
