#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('V32_6_RUN_DIR',ROOT/'evidence/generated'));OUT.mkdir(parents=True,exist_ok=True)
TEST='dist/tests/v32_15-causal-controls.test.js'
M=[
('tournament-external-trust','dist/src/benchmark/blinded-frontier-tournament-v32_15.js',"const externalTrust = trustPolicy.providerAuthorizations.every((auth) => auth.authorityClass === 'EXTERNAL_PINNED') && trustPolicy.judgeAuthorizations.every((auth) => auth.authorityClass === 'EXTERNAL_PINNED');","const externalTrust = true;",'causal tournament external trust pinning'),
('tournament-submission-signature','dist/src/benchmark/blinded-frontier-tournament-v32_15.js','|| !registry.verifyAt(envelope, submission.completedAt)','|| false','causal tournament submission signature'),
('tournament-score-signature','dist/src/benchmark/blinded-frontier-tournament-v32_15.js','|| !registry.verifyAt(envelope, score.scoredAt)','|| false','causal tournament score signature'),
('tournament-reveal-commitment','dist/src/benchmark/blinded-frontier-tournament-v32_15.js',"if (sha256({ runId: spec.runId, blindSaltDigest: spec.blindSaltDigest, labels: revealedLabels }) !== assignment.mappingCommitment)","if (false)",'causal tournament blind reveal commitment'),
('tournament-reviewer-independence','dist/src/benchmark/blinded-frontier-tournament-v32_15.js','entry.organizationId === judge.organizationId','false','causal tournament reviewer independence'),
('tournament-cost-budget','dist/src/benchmark/blinded-frontier-tournament-v32_15.js','if (observedCost > spec.maximumCostMicros)','if (false)','causal tournament cost budget'),
('component-production-evidence','dist/src/isolation/proof-carrying-wasm-component-v32_15.js',"if (policy.production && (manifest.synthetic || manifest.evidenceClass !== 'OBSERVED_EXTERNAL' || !manifest.runtimeQualified))","if (false)",'causal component production evidence'),
('component-reviewer-independence','dist/src/isolation/proof-carrying-wasm-component-v32_15.js','if (policy.requireIndependentReview && (manifest.publisherId === manifest.reviewerId || manifest.publisherKeyFingerprint === manifest.reviewerKeyFingerprint))','if (false)','causal component independent review'),
('component-capability-denial','dist/src/isolation/proof-carrying-wasm-component-v32_15.js','if (grants.some((item) => policy.deniedCapabilities.includes(item) || !policy.allowedCapabilities.includes(item)))','if (false)','causal component capability denial'),
('component-filesystem-traversal','dist/src/isolation/proof-carrying-wasm-component-v32_15.js',"if (grant.capability.startsWith('filesystem-') && grant.resources.some((resource) => !resource.startsWith('/data/') || resource.includes('..') || resource.includes('\\\\')))","if (false)",'causal component filesystem traversal'),
('component-binary-digest','dist/src/isolation/proof-carrying-wasm-component-v32_15.js','if (sha256Bytes(bytes) !== manifest.binaryDigest)','if (false)','causal component binary digest binding'),
('component-composition-cycle','dist/src/isolation/proof-carrying-wasm-component-v32_15.js','if (hasCycle(edges))','if (false)','causal component composition cycle'),
('multi-host-external-trust','dist/src/qualification/multi-host-challenge-v32_15.js',"if (challenge.mode !== 'LOCAL_PROCESS_DRY_RUN' && (o.synthetic || auth?.authorityClass !== 'EXTERNAL_PINNED'))","if (false)",'causal multi-host external trust pinning'),
('multi-host-lineage','dist/src/qualification/multi-host-challenge-v32_15.js','if (o.qualificationId !== challenge.qualificationId || o.runId !== challenge.runId || o.sourceDigest !== challenge.sourceDigest || o.buildDigest !== challenge.buildDigest || o.toolchainDigest !== challenge.toolchainDigest || o.environmentDigest !== challenge.environmentDigest || o.policyDigest !== challenge.policyDigest || o.nonce !== challenge.nonce || o.sequence !== challenge.sequence)','if (false)','causal multi-host lineage binding'),
('multi-host-expiry','dist/src/qualification/multi-host-challenge-v32_15.js','if (now.getTime() > expires)','if (false)','causal multi-host challenge expiry'),
('multi-host-provider-diversity','dist/src/qualification/multi-host-challenge-v32_15.js','if (providers.size < challenge.requiredProviders)','if (false)','causal multi-host provider diversity'),
('multi-host-signature','dist/src/qualification/multi-host-challenge-v32_15.js','|| !registry.verifyAt(response, o.observedAt)','|| false','causal multi-host signature verification'),
]
def run(pattern):
 return subprocess.run(['node','--test',f'--test-name-pattern={pattern}',TEST],cwd=ROOT,text=True,capture_output=True,timeout=30)
baseline=run('causal tournament external trust pinning')
if baseline.returncode!=0: raise SystemExit('baseline failed')
rows=[]
for name,rel,old,new,test_name in M:
 path=ROOT/rel; original=path.read_text()
 if original.count(old)!=1:
  rows.append({'name':name,'status':'invalid','reason':f'pattern-count:{original.count(old)}','causalTest':test_name});continue
 path.write_text(original.replace(old,new,1)); started=time.monotonic()
 try: result=run(test_name)
 except Exception as exc: result=None; rows.append({'name':name,'status':'invalid','reason':f'runner:{exc}','causalTest':test_name})
 finally: path.write_text(original)
 if result is not None:
  output=result.stdout+result.stderr; killed=result.returncode!=0 and f'not ok 1 - {test_name}' in output
  rows.append({'name':name,'status':'killed' if killed else 'survived','returnCode':result.returncode,'durationMs':round((time.monotonic()-started)*1000,3),'causalTest':test_name,'failureObserved':f'not ok 1 - {test_name}' in output,'outputTail':output[-1200:]})
report={'version':'32.15','total':len(M),'killed':sum(r['status']=='killed' for r in rows),'survived':sum(r['status']=='survived' for r in rows),'invalid':sum(r['status']=='invalid' for r in rows),'baselinePassed':True,'mutants':rows}
report['status']='passed' if report['killed']==len(M) else 'failed'
(OUT/'V32_15_FRONTIER_TOURNAMENT_WASM_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['status','total','killed','survived','invalid']},indent=2))
raise SystemExit(0 if report['status']=='passed' else 1)
