#!/usr/bin/env python3
from __future__ import annotations
import json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/v33.43'
checks=[]
def load(rel): return json.loads((ROOT/rel).read_text())
def add(name,ok,detail=None): checks.append({'name':name,'ok':bool(ok),'detail':detail})
required=['src/supply-chain/dependency-capsule-lifecycle-v33_43.ts','tests/dependency-capsule-lifecycle-v33_43.test.ts','scripts/dependency-capsule-lifecycle-proof-v33_43.mjs','scripts/verify-dependency-capsule-lifecycle-v33_43.mjs','docs/V33_43_DEPENDENCY_CAPSULE_LIFECYCLE.md','CLAUDE_HANDOFF_v33_43.md','V33_43_עדכון_ביצוע_והוכחות.md','pilot-kits/v33.43/dependency-capsule-lifecycle/manifest.json','pilot-kits/v33.43/dependency-capsule-lifecycle/RUNBOOK.md','pilot-kits/v33.43/dependency-capsule-lifecycle/replacement-package.json','pilot-kits/v33.43/dependency-capsule-lifecycle/replacement-package-lock.json','vendor/dependency-capsule/base-v33.42/package.json','vendor/dependency-capsule/base-v33.42/package-lock.json','release-evidence/v33.43/V33_43_DEPENDENCY_CAPSULE_LIFECYCLE_PROOF.json','release-evidence/v33.43/V33_43_INDEPENDENT_VERIFICATION.json','release-evidence/v33.43/V33_43_FOCUSED_TEST_RECEIPT.json','release-evidence/v33.43/V33_43_FULL_TEST_RESULTS.json','release-evidence/v33.43/V33_43_FULL_TEST_META.json','release-evidence/v33.43/V33_43_DIRECT_V33_RESULTS.json','release-evidence/v33.43/V33_43_REPOSITORY_TRUTH_MAP.json','release-evidence/v33.43/V33_43_ARCHITECTURE_INTEGRITY.json']
add('required-artifacts',all((ROOT/p).exists() for p in required),[p for p in required if not (ROOT/p).exists()])
try:
 p=load('release-evidence/v33.43/V33_43_DEPENDENCY_CAPSULE_LIFECYCLE_PROOF.json');s=p.get('summary',{});b=p.get('truthBoundary',{});add('proof-summary',s.get('newSignatureCount')==15 and s.get('totalChainSignatureCount')==17 and s.get('packageCount')==3 and s.get('rollbackProven') is True and s.get('replacementOfflineInstallProven') is True,s);add('proof-attacks',len(p.get('attacks',{}))==5 and all(p.get('attacks',{}).values()),p.get('attacks'));add('truth-boundary',b.get('vulnerabilityIntelligenceExternalObserved') is False and b.get('externalHumanParticipants')==0 and b.get('productionAuthority')=='NONE' and b.get('externalEffectsExecuted')==0,b)
except Exception as e:add('proof-readable',False,str(e))
for rel,name in [('release-evidence/v33.43/V33_43_INDEPENDENT_VERIFICATION.json','independent-verification'),('release-evidence/v33.43/V33_43_FOCUSED_TEST_RECEIPT.json','focused-regression'),('release-evidence/v33.43/V33_43_FULL_TEST_RESULTS.json','full-regression'),('release-evidence/v33.43/V33_43_DIRECT_V33_RESULTS.json','direct-v33-regression'),('release-evidence/v33.43/V33_43_REPOSITORY_TRUTH_MAP.json','repository-truth-map'),('release-evidence/v33.43/V33_43_ARCHITECTURE_INTEGRITY.json','architecture-integrity')]:
 try:
  x=load(rel);add(name,x.get('status') in ('PASS','passed'),x.get('status'))
 except Exception as e:add(name,False,str(e))
try:
 x=load('release-evidence/v33.43/V33_43_FULL_TEST_META.json');rows=x.get('files',[]);bd=x.get('buildDigest');rd=x.get('runInputDigest');add('regression-input-binding',x.get('exitCode')==0 and len(rows)>0 and isinstance(bd,str) and len(bd)==64 and isinstance(rd,str) and len(rd)==64 and all(r.get('buildDigest')==bd and r.get('runInputDigest')==rd for r in rows),{'receipts':len(rows),'buildDigest':bd,'runInputDigest':rd})
except Exception as e:add('regression-input-binding',False,str(e))
status='PASS' if all(c['ok'] for c in checks) else 'FAIL';result={'version':'33.43','status':status,'checkCount':len(checks),'passed':sum(c['ok'] for c in checks),'failed':sum(not c['ok'] for c in checks),'checks':checks};OUT.mkdir(parents=True,exist_ok=True);(OUT/'V33_43_FINAL_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if status=='PASS' else 1)
