#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('V32_6_RUN_DIR',ROOT/'evidence/generated'));OUT.mkdir(parents=True,exist_ok=True)
TEST='dist/tests/v32_18-causal-controls.test.js'
M=[
('retry-idempotency','dist/src/platform/sovereign-control-plane-v32_18.js',"if (input.retry.maxAttempts > 1 && !input.idempotent && !input.idempotencyKeyRequired)","if (false)",'causal v32.18 retry idempotency binding'),
('worst-case-duration','dist/src/platform/sovereign-control-plane-v32_18.js',"if (worstCaseDurationMs > 600_000)","if (false)",'causal v32.18 worst-case duration ceiling'),
('durable-chain','dist/src/platform/sovereign-control-plane-v32_18.js',"if (event.previousEventDigest !== previous)","if (false)",'causal v32.18 durable chain binding'),
('durable-event-digest','dist/src/platform/sovereign-control-plane-v32_18.js',"if (durableEventDigestV32_18(material) !== event.eventDigest)","if (false)",'causal v32.18 durable event digest binding'),
('effect-ownership','dist/src/platform/sovereign-control-plane-v32_18.js',"if (owner !== undefined && owner !== event.stepId)","if (false)",'causal v32.18 exactly-once effect ownership'),
('node-attestation','dist/src/platform/sovereign-control-plane-v32_18.js',"if (!observation.nodeAttested)","if (false)",'causal v32.18 node attestation requirement'),
('selector-binding','dist/src/platform/sovereign-control-plane-v32_18.js',"if (selectors.size !== observation.selectors.length || observation.requiredSelectors.some((selector) => !selectors.has(selector)))","if (false)",'causal v32.18 selector binding'),
('federation-bundle','dist/src/platform/sovereign-control-plane-v32_18.js',"if (foreign && policy.requireFederationForForeignDomain && !/^[0-9a-f]{64}$/.test(observation.federatedBundleDigest ?? ''))","if (false)",'causal v32.18 federation bundle requirement'),
('mandatory-telemetry','dist/src/platform/sovereign-control-plane-v32_18.js',"const mandatory = traces.filter((trace) => trace.error || trace.securityRelevant || trace.durationMs >= policy.latencyThresholdMs).sort(compareTrace);","const mandatory = traces.filter((trace) => false).sort(compareTrace);",'causal v32.18 mandatory telemetry preservation'),
('duplicate-trace','dist/src/platform/sovereign-control-plane-v32_18.js',"ids.has(trace.traceId) || ","false || ",'causal v32.18 duplicate trace rejection'),
('postgres-rpo','dist/src/platform/sovereign-control-plane-v32_18.js',"if (maximumLag > policy.maximumRpoBytes)","if (false)",'causal v32.18 postgres RPO ceiling'),
('postgres-restore','dist/src/platform/sovereign-control-plane-v32_18.js',"if (!observation.restoreProbePassed)","if (false)",'causal v32.18 postgres restore probe'),
('postgres-sync-replica','dist/src/platform/sovereign-control-plane-v32_18.js',"if (observation.synchronousReplicasObserved < observation.synchronousReplicasRequired || observation.synchronousReplicasRequired < 1)","if (false)",'causal v32.18 postgres synchronous replica requirement'),
]
def run(pattern): return subprocess.run(['node','--test',f'--test-name-pattern={pattern}',TEST],cwd=ROOT,text=True,capture_output=True,timeout=45)
base=subprocess.run(['node','--test',TEST],cwd=ROOT,text=True,capture_output=True,timeout=90)
if base.returncode!=0: raise SystemExit('baseline failed:'+base.stdout+base.stderr)
rows=[]
for name,rel,old,new,test_name in M:
 path=ROOT/rel;original=path.read_text();count=original.count(old)
 if count!=1: rows.append({'name':name,'status':'invalid','reason':f'pattern-count:{count}','causalTest':test_name});continue
 path.write_text(original.replace(old,new,1));started=time.monotonic()
 try: result=run(test_name)
 except Exception as exc: result=None;rows.append({'name':name,'status':'invalid','reason':f'runner:{exc}','causalTest':test_name})
 finally: path.write_text(original)
 if result is not None:
  output=result.stdout+result.stderr;marker=f'not ok 1 - {test_name}';killed=result.returncode!=0 and marker in output
  rows.append({'name':name,'status':'killed' if killed else 'survived','returnCode':result.returncode,'durationMs':round((time.monotonic()-started)*1000,3),'causalTest':test_name,'failureObserved':marker in output,'outputTail':output[-1000:]})
report={'version':'32.18','total':len(M),'killed':sum(r['status']=='killed' for r in rows),'survived':sum(r['status']=='survived' for r in rows),'invalid':sum(r['status']=='invalid' for r in rows),'baselinePassed':True,'mutants':rows};report['status']='passed' if report['killed']==len(M) else 'failed'
(OUT/'V32_18_CNCF_GOLD_MINE_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['status','total','killed','survived','invalid']},indent=2))
if report['status']!='passed':
 for row in rows:
  if row['status']!='killed': print(json.dumps(row,indent=2))
raise SystemExit(0 if report['status']=='passed' else 1)
