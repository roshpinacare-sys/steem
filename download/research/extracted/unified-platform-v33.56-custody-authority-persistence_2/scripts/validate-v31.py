#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, shutil, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated'; QUAR=ROOT/'evidence/quarantine'; STATE=OUT/'.v31-validation-state.json'
STAGES={
 'build':(['npm','run','build:clean:v31'],{0}),
 'prepare-isolation':(['bash','scripts/prepare-linux-probes-v31.sh'],{0}),
 'tests':(['python3','scripts/run-tests-v31-parallel.py'],{0}),
 'coverage':(['node','scripts/run-coverage-v31.mjs'],{0}),
 'quality':(['node','scripts/test-quality-audit-v31.mjs'],{0}),
 'incomplete-audit':(['node','scripts/incomplete-code-audit-v31.mjs'],{0}),
 'architecture':(['node','scripts/architecture-validation-v31.mjs'],{0}),
 'claim-falsification':(['node','scripts/claim-falsification-v31.mjs'],{0}),
 'sovereignty-mutation':(['python3','scripts/run-sovereignty-mutation-v31.py'],{0}),
 'sovereignty-value-proof':(['node','scripts/sovereignty-value-proof-v31.mjs'],{0}),
 'integration-closure':(['node','scripts/integration-closure-v31.mjs'],{0}),
 'supply-chain':(['node','scripts/supply-chain-report-v31.mjs'],{0}),
 'dr':(['node','scripts/local-dr-rehearsal-v31.mjs'],{0}),
 'pilot-protocol':(['node','scripts/generate-human-pilot-v31.mjs'],{0}),
 'operations':(['node','scripts/generate-operations-report-v31.mjs'],{0}),
 'browser':(['python3','e2e/test_breakthrough_pilot_v31.py'],{0}),
 'isolation':(['bash','scripts/run-linux-isolation-v31.sh'],{0}),
 'postgres':(['node','scripts/qualify-postgres-v31.mjs'],{0,2}),
 'stability':(['python3','scripts/stability-v31.py'],{0}),
 'qualification':(['node','scripts/qualification-matrix-v31.mjs'],{0}),
}
REPORTS={
 'prepare-isolation':'V31_LINUX_PROBE_CACHE.json','tests':'V31_TEST_RESULTS.json','coverage':'V31_COVERAGE_REPORT.json','quality':'V31_TEST_QUALITY_AUDIT.json','incomplete-audit':'V31_INCOMPLETE_CODE_AUDIT.json','architecture':'V31_ARCHITECTURE_INTEGRITY.json','claim-falsification':'V31_CLAIM_FALSIFICATION.json','sovereignty-mutation':'V31_SOVEREIGNTY_MUTATION_RESULTS.json','sovereignty-value-proof':'V31_SOVEREIGNTY_VALUE_PROOF.json','integration-closure':'V31_INTEGRATION_CLOSURE.json','supply-chain':'V31_SUPPLY_CHAIN_REPORT.json','dr':'V31_LOCAL_DR_REHEARSAL.json','pilot-protocol':'V31_HUMAN_PILOT_PROTOCOL.json','operations':'V31_OPERATIONAL_ACTION_CENTER.json','browser':'V31_BROWSER_E2E.json','isolation':'V31_LINUX_ISOLATION.json','postgres':'V31_POSTGRES_QUALIFICATION.json','stability':'V31_STABILITY_REPORT.json','qualification':'V31_QUALIFICATION_MATRIX.json'}
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
 state=json.loads(STATE.read_text()); current=source_digest()
 if state['sourceDigest']!=current: raise SystemExit(f'validation_source_digest_changed:{state["sourceDigest"]}:{current}')
 return state
def initialize():
 OUT.mkdir(parents=True,exist_ok=True); QUAR.mkdir(parents=True,exist_ok=True)
 old=[p for p in OUT.iterdir()]
 if old:
  q=QUAR/f'v31-{int(time.time())}'; q.mkdir(parents=True)
  for item in old: shutil.move(str(item),q/item.name)
 shutil.rmtree(ROOT/'dist',ignore_errors=True); shutil.rmtree(ROOT/'.cache',ignore_errors=True); OUT.mkdir(parents=True,exist_ok=True)
 state={'version':'31.0','status':'IN_PROGRESS','startedAt':utc(),'sourceDigest':source_digest(),'checks':{}}; save(state); print(json.dumps({'status':'initialized','sourceDigest':state['sourceDigest']}),flush=True)
def stage(name):
 if name not in STAGES: raise SystemExit(f'unknown_stage:{name}')
 state=load(); cmd,accepted=STAGES[name]; start=time.perf_counter(); log=OUT/f'v31-{name}.log'
 with log.open('w',encoding='utf-8') as handle:
  p=subprocess.run(cmd,cwd=ROOT,text=True,stdout=handle,stderr=subprocess.STDOUT,env={**os.environ,'NODE_OPTIONS':'','NODE_ENV':'test'})
 status='passed' if p.returncode in accepted else 'failed'; row={'name':name,'command':cmd,'acceptedExitCodes':sorted(accepted),'exitCode':p.returncode,'durationMs':round((time.perf_counter()-start)*1000,3),'status':status,'log':str(log.relative_to(ROOT)),'sourceDigest':state['sourceDigest']}; state['checks'][name]=row; save(state); print(json.dumps(row),flush=True)
 if status!='passed': print(log.read_text(errors='replace')[-20000:],file=sys.stderr); raise SystemExit(p.returncode or 1)
 report=REPORTS.get(name)
 if report and not (OUT/report).exists(): raise SystemExit(f'stage_report_missing:{report}')
def read(name): return json.loads((OUT/name).read_text())
def finalize():
 state=load(); missing=[n for n in STAGES if state['checks'].get(n,{}).get('status')!='passed']
 if missing: raise SystemExit('validation_stages_missing:'+','.join(missing))
 tests=read('V31_TEST_RESULTS.json'); coverage=read('V31_COVERAGE_REPORT.json'); quality=read('V31_TEST_QUALITY_AUDIT.json'); incomplete=read('V31_INCOMPLETE_CODE_AUDIT.json'); architecture=read('V31_ARCHITECTURE_INTEGRITY.json'); claims=read('V31_CLAIM_FALSIFICATION.json'); mutation=read('V31_SOVEREIGNTY_MUTATION_RESULTS.json'); value=read('V31_SOVEREIGNTY_VALUE_PROOF.json'); integration=read('V31_INTEGRATION_CLOSURE.json'); supply=read('V31_SUPPLY_CHAIN_REPORT.json'); dr=read('V31_LOCAL_DR_REHEARSAL.json'); browser=read('V31_BROWSER_E2E.json'); isolation=read('V31_LINUX_ISOLATION.json'); postgres=read('V31_POSTGRES_QUALIFICATION.json'); stability=read('V31_STABILITY_REPORT.json'); qualification=read('V31_QUALIFICATION_MATRIX.json'); operations=read('V31_OPERATIONAL_ACTION_CENTER.json'); pilot=read('V31_HUMAN_PILOT_PROTOCOL.json'); im=integration['summary']
 assertions={
  'allStagesPassed':all(x['status']=='passed' for x in state['checks'].values()),
  'testsPassed':tests['status']=='passed' and tests['totals']['tests']==tests['totals']['passed'] and tests['totals']['failed']==0 and tests['totals']['tests']>=547,
  'coverageFloor':coverage['status']=='passed' and coverage['current']['linePercent']>=99 and coverage['current']['branchPercent']>=96 and coverage['current']['functionPercent']>=98.5,
  'qualityPassed':quality['status']=='passed' and quality['criticalOrHighIssues']==0 and quality['mediumIssues']==0,
  'incompleteAuditPassed':incomplete['status']=='passed' and not incomplete['explicitIncompleteMarkers'] and not incomplete['packageScriptTargets']['missing'] and not incomplete['criticalIntegrationGaps'],
  'architectureClosed':architecture['status']=='PASS' and architecture['metrics']['sourceCycleCount']==0 and architecture['metrics']['untestedSourceCount']==0 and architecture['metrics']['closedCapabilityPathCount']==architecture['metrics']['capabilityPathCount'] and architecture['metrics']['capabilityPathCount']>=13,
  'claimsFalsified':claims['status']=='passed' and claims['summary']['passedClaims']==claims['summary']['claims'] and claims['summary']['rejectedOrDowngraded']>=7,
  'mutationsAuthentic':mutation['status']=='passed' and mutation['mutantsKilledAuthentically']==mutation['mutantsSpecified'] and mutation['mutantsSpecified']>=14 and mutation['survivors']==0 and mutation['invalidKills']==0,
  'sovereigntyProofBounded':value['status']=='passed' and value['results']['campaignState']=='COMPLETED' and value['results']['campaignProgressPercent']==100 and value['results']['independentSignedReviewers']>=2 and value['results']['independentReviewerOrganizations']>=2 and value['results']['externalInteractionsExecuted']==5 and value['results']['externalMutationsExecuted']==0 and value['results']['restartReplayProviderInteractions']==0 and value['results']['revokedCredentialReplayBlocked'] is True and value['valueEvidence']['claimedStatus']=='PROMISING_NOT_HUMAN_VALIDATED',
  'integrationClosed':integration['status']=='passed' and im['closed']==im['edges'] and im['edges']>=14 and im['externalInteractionsExecuted']==5 and im['externalMutationsExecuted']==0,
  'supplyChainPassed':supply['status'] in ['passed','passed-with-advisory-environment-blocked'],
  'drPassed':dr['status']=='passed-local-rehearsal','browserPassed':browser['status']=='passed','isolationResearchProof':isolation['status']=='passed-single-host-research-proof','postgresHonest':postgres['status'] in ['environment-blocked','implemented-and-exercised-single-database'],
  'stabilityPassed':stability['status']=='passed' and stability['flakeCount']==0 and len(stability['runs'])==3,
  'operationsFailClosed':operations['status']=='passed' and operations['campaign']['externalInteractionsExecuted']==5 and operations['campaign']['externalMutationsExecuted']==0 and operations['campaign']['revokedCredentialReplayBlocked'] is True,
  'pilotNotFabricated':pilot['status']=='protocol-ready-not-executed','qualificationIntegratedPilot':qualification['status']=='passed-integrated-pilot' and qualification['productionPromotion']=='blocked',
 }
 status='passed' if all(assertions.values()) else 'failed'
 report={'version':'31.0','status':status,'classification':'adversarial-sovereignty-claim-falsification-provider-attestation-and-independent-review-validation','startedAt':state['startedAt'],'finishedAt':utc(),'sourceDigest':state['sourceDigest'],'checks':[state['checks'][x] for x in STAGES],'assertions':assertions,'results':{'tests':tests['totals'],'coverage':coverage['current'],'testQuality':{'files':quality['filesAudited'],'tests':quality['testsDeclared'],'assertions':quality['assertCalls'],'criticalOrHighIssues':quality['criticalOrHighIssues'],'mediumIssues':quality['mediumIssues']},'architecture':architecture['metrics'],'claims':claims['summary'],'mutations':{k:mutation[k] for k in ('mutantsSpecified','mutantsKilledAuthentically','survivors','invalidKills')},'sovereignty':{'providerInteractions':value['results']['externalInteractionsExecuted'],'externalMutations':value['results']['externalMutationsExecuted'],'restartReplayProviderInteractions':value['results']['restartReplayProviderInteractions'],'revokedCredentialReplayBlocked':value['results']['revokedCredentialReplayBlocked'],'reviewerOrganizations':value['results']['independentReviewerOrganizations'],'campaignState':value['results']['campaignState'],'claimBoundary':value['valueEvidence']['claimedStatus']},'integration':im,'stability':stability['statistics'],'readiness':qualification['readiness'],'productionPromotion':qualification['productionPromotion']},'limitations':['The attested provider is a deterministic local fixture and does not qualify a live external advanced-model service.','Provider and reviewer attestations prove identity, authorization and binding, not model correctness or externally audited organizational independence.','File leases, replay and trust registries are single-host mechanisms, not distributed consensus or durable external governance.','Human and commercial value remain unmeasured; PostgreSQL, KMS/HSM, independent security, licensing and multi-host SLO/DR remain blocked.']}
 (OUT/'V31_FINAL_VALIDATION.json').write_text(json.dumps(report,indent=2)+'\n'); state['status']=status.upper(); state['finishedAt']=report['finishedAt']; save(state); print(json.dumps({'status':status,'assertions':assertions,'results':report['results']},indent=2)); raise SystemExit(0 if status=='passed' else 1)
def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--initialize',action='store_true'); ap.add_argument('--stage',choices=list(STAGES)); ap.add_argument('--finalize',action='store_true'); a=ap.parse_args()
 if a.initialize: initialize(); return
 if a.stage: stage(a.stage); return
 if a.finalize: finalize(); return
 initialize()
 for name in STAGES: stage(name)
 finalize()
if __name__=='__main__': main()
