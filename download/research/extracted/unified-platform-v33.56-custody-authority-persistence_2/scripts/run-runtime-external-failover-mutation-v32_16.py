#!/usr/bin/env python3
from __future__ import annotations
import json,os,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('V32_6_RUN_DIR',ROOT/'evidence/generated'));OUT.mkdir(parents=True,exist_ok=True)
TEST='dist/tests/v32_16-causal-controls.test.js'
M=[
('wasm-visible-memory','dist/src/isolation/wasm-runtime-qualification-v32_16.js',"if (memoryExports.length !== 1 || memoryExports[0]?.name !== options.policy.requiredMemoryExport) {","if (false) {",'causal WASM visible memory enforcement'),
('wasm-timeout-classification','dist/src/isolation/wasm-runtime-qualification-v32_16.js',"if (message === 'wasm-runtime-timeout')","if (false)",'causal WASM timeout classification'),
('wasm-memory-limit','dist/src/isolation/wasm-runtime-qualification-v32_16.js','else if (memoryBytes > options.policy.maximumMemoryBytes)','else if (false)','causal WASM measured memory limit'),
('transport-external-trust','dist/src/benchmark/external-tournament-transport-v32_16.js',"authorization?.authority === 'EXTERNAL_PINNED'","true",'causal transport external trust pinning'),
('transport-independence','dist/src/benchmark/external-tournament-transport-v32_16.js',"if (observed.observerId === options.invocation.providerId || observed.observerOrganizationId === observed.providerOrganizationId) {","if (false) {",'causal transport observer independence'),
('transport-signature','dist/src/benchmark/external-tournament-transport-v32_16.js','|| !options.registry.verifyAt(options.observation, observed.observedAt)',"|| false",'causal transport signature verification'),
('transport-lineage','dist/src/benchmark/external-tournament-transport-v32_16.js','if (observed.invocationDigest !== invocationDigest || observed.providerId !== options.invocation.providerId || observed.externalResponseId !== options.invocation.externalResponseId || observed.requestDigest !== options.invocation.requestDigest || observed.responseDigest !== options.invocation.responseDigest) {','if (false) {','causal transport lineage binding'),
('transport-observation-validity','dist/src/benchmark/external-tournament-transport-v32_16.js',"const external = findings.length === 0 && options.mode === 'EXTERNAL_OBSERVED'","const external = true && options.mode === 'EXTERNAL_OBSERVED'",'causal transport external observation validity binding'),
('failover-replication','dist/src/qualification/local-process-failover-lab-v32_16.js','await replicate(secondary, value, policy.requestTimeoutMs);','void 0;','causal failover replication preserves RPO zero'),
('failover-rto','dist/src/qualification/local-process-failover-lab-v32_16.js','if (rtoMs > policy.maximumRtoMs)','if (false)','causal failover RTO policy enforcement'),
('failover-cleanup','dist/src/qualification/local-process-failover-lab-v32_16.js','childProcessesCleaned: cleaned,','childProcessesCleaned: false,','causal failover child cleanup'),
]
def run(pattern):
 return subprocess.run(['node','--test',f'--test-name-pattern={pattern}',TEST],cwd=ROOT,text=True,capture_output=True,timeout=30)
base=run('causal WASM visible memory enforcement')
if base.returncode!=0: raise SystemExit('baseline failed:'+base.stdout+base.stderr)
rows=[]
for name,rel,old,new,test_name in M:
 path=ROOT/rel;original=path.read_text();count=original.count(old)
 if count!=1:
  rows.append({'name':name,'status':'invalid','reason':f'pattern-count:{count}','causalTest':test_name});continue
 path.write_text(original.replace(old,new,1));started=time.monotonic()
 try: result=run(test_name)
 except Exception as exc: result=None;rows.append({'name':name,'status':'invalid','reason':f'runner:{exc}','causalTest':test_name})
 finally: path.write_text(original)
 if result is not None:
  output=result.stdout+result.stderr;killed=result.returncode!=0 and f'not ok 1 - {test_name}' in output
  rows.append({'name':name,'status':'killed' if killed else 'survived','returnCode':result.returncode,'durationMs':round((time.monotonic()-started)*1000,3),'causalTest':test_name,'failureObserved':f'not ok 1 - {test_name}' in output,'outputTail':output[-1000:]})
report={'version':'32.16','total':len(M),'killed':sum(r['status']=='killed' for r in rows),'survived':sum(r['status']=='survived' for r in rows),'invalid':sum(r['status']=='invalid' for r in rows),'baselinePassed':True,'mutants':rows}
report['status']='passed' if report['killed']==len(M) else 'failed'
(OUT/'V32_16_RUNTIME_EXTERNAL_FAILOVER_MUTATION_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['status','total','killed','survived','invalid']},indent=2))
raise SystemExit(0 if report['status']=='passed' else 1)
