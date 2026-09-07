#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated/v22-test-batches'; OUT.mkdir(parents=True,exist_ok=True)
batches=[
 ('canonical-contracts',['adapters','contracts','digital-thread','failure-knowledge','integrated-engineering-commitment','standards-adapters','system-contracts'],50),
 ('durability-and-keys',['backup-restore','durable','encrypted-keystore','key-lifecycle','postgres-contract'],55),
 ('governance-and-private-platform',['governance-consistency','private-identity','private-pilot-context','artifact-store','release-manifest','telemetry'],55),
 ('breakthrough-evidence',['evidence-completeness','offline-verification','decision-brief'],50),
 ('breakthrough-trust-recovery',['capability-trust','capability-trust-concurrency-v22','incident-recertification'],55),
 ('domain-and-agent-adapters',['domain-pack-generator','governed-agent','source-adapters-v20','session-archiver'],55),
 ('process-and-repository',['multiprocess','repository-change'],70),
 ('wasm',['wasm-capability-runner','wasm-isolation'],50),
 ('linux-and-server-config',['linux-isolation','private-server-config'],60),
 ('web',['web-server','web-workflow','private-pilot-server'],65),
 ('v22-provenance-and-clean-state',['test-execution-provenance','clean-state-validation'],55),
 ('v22-generative-adversarial',['property-invariants-v22','model-based-v22','fuzz-v22'],70),
]
def count(text,label):
 m=re.findall(rf'^# {re.escape(label)} (\d+)$',text,re.M); return int(m[-1]) if m else 0
records=[]
for name,names,deadline in batches:
 files=[f'dist/tests/{x}.test.js' for x in names]
 cmd=['node','--test','--test-concurrency=1','--test-force-exit',*files]
 log=OUT/f'{name}.log'; started=time.perf_counter(); timed=False
 with log.open('w',encoding='utf-8') as stream:
  try:
   result=subprocess.run(cmd,cwd=ROOT,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''},stdout=stream,stderr=subprocess.STDOUT,text=True,timeout=deadline,start_new_session=True)
   rc=result.returncode
  except subprocess.TimeoutExpired as exc:
   timed=True; rc=124
 elapsed=round((time.perf_counter()-started)*1000,3)
 output=log.read_text(encoding='utf-8',errors='replace')
 tests,passed,failed=count(output,'tests'),count(output,'pass'),count(output,'fail')
 status='passed' if rc==0 and not timed and tests>0 and tests==passed and failed==0 else 'failed'
 rec={'batch':name,'testFiles':files,'tests':tests,'passed':passed,'failed':failed,'runnerExitCode':rc,'timedOut':timed,'durationMs':elapsed,'status':status,'path':str(log.relative_to(ROOT))}
 records.append(rec); print(json.dumps(rec),flush=True)
 if status!='passed':
  print(output[-12000:],file=sys.stderr); break
report={'version':'22.0','status':'passed' if len(records)==len(batches) and all(r['status']=='passed' for r in records) else 'failed','runner':'twelve isolated serial subprocesses with hard timeouts and executed TAP counting','batches':records,'totals':{'testFiles':sum(len(r['testFiles']) for r in records),'tests':sum(r['tests'] for r in records),'passed':sum(r['passed'] for r in records),'failed':sum(r['failed'] for r in records),'durationMs':round(sum(r['durationMs'] for r in records),3)},'qualityModel':{'countsExecutedTapOnly':True,'criticalPrototypeLanes':['breakthrough-evidence','breakthrough-trust-recovery','domain-and-agent-adapters','v22-provenance-and-clean-state','v22-generative-adversarial'],'productionClaimsExcluded':True},'limitations':['Production isolation, PostgreSQL multi-host behavior, real users and external security review remain separate blocked gates.']}
(ROOT/'evidence/generated/V22_TEST_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report['totals']),flush=True)
raise SystemExit(0 if report['status']=='passed' else 1)
