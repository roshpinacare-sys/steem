#!/usr/bin/env python3
from __future__ import annotations
import json, re, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'release-evidence/v33.44'; checks=[]
def load(rel): return json.loads((ROOT/rel).read_text())
def add(name,ok,detail=None): checks.append({'name':name,'ok':bool(ok),'detail':detail})
required=['src/supply-chain/dependency-update-planner-v33_44.ts','tests/dependency-update-planner-v33_44.test.ts','scripts/dependency-update-planner-proof-v33_44.mjs','scripts/verify-dependency-update-planner-v33_44.mjs','scripts/run-focused-tests-v33_44.mjs','scripts/run-full-regression-v33_44.py','scripts/run-direct-v33-regression-v33_44.py','scripts/repository-truth-map-v33_44.mjs','scripts/architecture-validation-v33_44.mjs','docs/V33_44_DEPENDENCY_UPDATE_PLANNER.md','CLAUDE_HANDOFF_v33_44.md','V33_44_עדכון_ביצוע_והוכחות.md','pilot-kits/v33.44/dependency-update-planner/manifest.json','pilot-kits/v33.44/dependency-update-planner/RUNBOOK.md','release-evidence/v33.44/V33_44_DEPENDENCY_UPDATE_PLANNER_PROOF.json','release-evidence/v33.44/V33_44_INDEPENDENT_VERIFICATION.json','release-evidence/v33.44/V33_44_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.44/V33_44_FULL_TEST_RESULTS.json','release-evidence/v33.44/V33_44_FULL_TEST_META.json','release-evidence/v33.44/V33_44_DIRECT_V33_RESULTS.json','release-evidence/v33.44/V33_44_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.44/V33_44_ARCHITECTURE_INTEGRITY.json']
add('required-artifacts',all((ROOT/p).exists() for p in required),[p for p in required if not (ROOT/p).exists()])
try:
 p=load('release-evidence/v33.44/V33_44_DEPENDENCY_UPDATE_PLANNER_PROOF.json');s=p.get('summary',{});b=p.get('truthBoundary',{});e=p.get('executionEvidence',{})
 add('proof-summary',s.get('newSignatureCount')==17 and s.get('totalChainSignatureCount')==34 and s.get('candidateCount')==3 and s.get('approvalCount')==3 and s.get('canaryMonitorCount')==3 and s.get('retainedGenerationCount')==3,s)
 add('proof-execution',e.get('offlineInstall',{}).get('exitCode')==0 and e.get('offlineInstall',{}).get('cacheInitiallyEmpty') is True and e.get('offlineInstall',{}).get('networkRequestsObserved')==0 and e.get('build',{}).get('exitCode')==0 and e.get('tests',{}).get('testCount')==33 and e.get('tests',{}).get('failed')==0,e)
 add('proof-attacks',len(p.get('attacks',{}))==6 and all(p.get('attacks',{}).values()),p.get('attacks'))
 add('truth-boundary',b.get('candidateVersionsExternallyFetched') is False and b.get('externalCanaryTrafficObserved') is False and b.get('externalVulnerabilityIntelligenceObserved') is False and b.get('externalHumanParticipants')==0 and b.get('productionAuthority')=='NONE' and b.get('externalEffectsExecuted')==0,b)
except Exception as ex:add('proof-readable',False,str(ex))
for rel,name in [('release-evidence/v33.44/V33_44_INDEPENDENT_VERIFICATION.json','independent-verification'),('release-evidence/v33.44/V33_44_REPOSITORY_TRUTH_MAP.json','repository-truth-map'),('release-evidence/v33.44/V33_44_ARCHITECTURE_INTEGRITY.json','architecture-integrity')]:
 try:
  x=load(rel);add(name,x.get('status') in ('PASS','passed'),x.get('status'))
 except Exception as ex:add(name,False,str(ex))
try:
 x=load('release-evidence/v33.44/V33_44_FOCUSED_TEST_RECEIPT.json');add('focused-regression',x.get('status')=='passed' and x.get('testFiles')==15 and x.get('totals')=={'tests':511,'passed':511,'failed':0},x.get('totals'))
except Exception as ex:add('focused-regression',False,str(ex))
try:
 x=load('release-evidence/v33.44/V33_44_FULL_TEST_RESULTS.json');add('full-regression',x.get('status')=='passed' and x.get('totals')=={'testFiles':229,'tests':2336,'passed':2336,'failed':0},x.get('totals'))
except Exception as ex:add('full-regression',False,str(ex))
try:
 x=load('release-evidence/v33.44/V33_44_DIRECT_V33_RESULTS.json');add('direct-v33-regression',x.get('status')=='passed' and x.get('totals')=={'testFiles':44,'tests':1169,'passed':1169,'failed':0},x.get('totals'))
except Exception as ex:add('direct-v33-regression',False,str(ex))
try:
 x=load('release-evidence/v33.44/V33_44_REPOSITORY_TRUTH_MAP.json');inv=x.get('inventory',{});add('truth-inventory',inv.get('sourceModules')==233 and inv.get('testFiles')==229 and x.get('findings')==[],inv)
except Exception as ex:add('truth-inventory',False,str(ex))
try:
 x=load('release-evidence/v33.44/V33_44_ARCHITECTURE_INTEGRITY.json');m=x.get('metrics',{});add('architecture-metrics',x.get('status')=='PASS' and m.get('capabilityPathCount')==169 and m.get('closedCapabilityPathCount')==169 and m.get('sourceCycleCount')==0 and m.get('untestedSourceCount')==0,m)
except Exception as ex:add('architecture-metrics',False,str(ex))
try:
 x=load('release-evidence/v33.44/V33_44_FULL_TEST_META.json');rows=x.get('files',[]);bd=x.get('buildDigest');rd=x.get('runInputDigest');add('regression-input-binding',x.get('exitCode')==0 and len(rows)==229 and isinstance(bd,str) and len(bd)==64 and isinstance(rd,str) and len(rd)==64 and all(r.get('buildDigest')==bd and r.get('runInputDigest')==rd for r in rows),{'receipts':len(rows),'buildDigest':bd,'runInputDigest':rd})
except Exception as ex:add('regression-input-binding',False,str(ex))
try:
 pkg=load('package.json'); lock=load('package-lock.json'); txt=(ROOT/'package-lock.json').read_text(); gov=[load(f'governance-state/{p.name}') for p in (ROOT/'governance-state').glob('*.json')];add('canonical-metadata',pkg.get('version')=='0.34.0' and re.search(r'v33\.44',pkg.get('description',''),re.I) is not None and lock.get('version')=='0.34.0' and all(g.get('version')=='33.44' for g in gov),{'packageVersion':pkg.get('version'),'lockVersion':lock.get('version')});add('offline-lockfile',not any(token in txt for token in ['https://registry.npmjs.org','http://registry.npmjs.org']),None)
except Exception as ex:add('canonical-metadata',False,str(ex))
status='PASS' if all(c['ok'] for c in checks) else 'FAIL';result={'version':'33.44','status':status,'checkCount':len(checks),'passed':sum(c['ok'] for c in checks),'failed':sum(not c['ok'] for c in checks),'checks':checks};OUT.mkdir(parents=True,exist_ok=True);(OUT/'V33_44_FINAL_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if status=='PASS' else 1)
