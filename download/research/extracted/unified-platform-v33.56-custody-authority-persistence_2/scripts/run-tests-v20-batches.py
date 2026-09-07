#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated/v20-test-batches'; OUT.mkdir(parents=True,exist_ok=True)
batches=[
 ('canonical-core',['adapters','backup-restore','contracts','digital-thread','durable','failure-knowledge','integrated-engineering-commitment','key-lifecycle','postgres-contract','shadow-flow','standards-adapters','system-contracts'],45),
 ('v20-governance-security',['governance-consistency','encrypted-keystore','private-identity','private-pilot-context'],45),
 ('v20-platform',['artifact-store','governed-agent','release-manifest','session-archiver','source-adapters-v20','telemetry'],55),
 ('process',['multiprocess'],45),('repository',['repository-change'],55),('wasm',['wasm-capability-runner','wasm-isolation'],45),
 ('linux-and-private-server',['linux-isolation','private-server-config'],55),
 ('web',['web-server','web-workflow','private-pilot-server'],55),
]
def c(text,label):
 m=re.findall(rf'^# {re.escape(label)} (\d+)$',text,re.M); return int(m[-1]) if m else 0
records=[]
for name,names,deadline in batches:
 files=[f'dist/tests/{x}.test.js' for x in names]
 cmd=['node','--test','--test-concurrency=1','--test-force-exit',*files]
 log=OUT/f'{name}.log'
 timed=False
 with log.open('w',encoding='utf-8') as stream:
  try:
   r=subprocess.run(cmd,cwd=ROOT,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''},stdout=stream,stderr=subprocess.STDOUT,text=True,timeout=deadline)
   rc=r.returncode
  except subprocess.TimeoutExpired:
   timed=True; rc=124
 output=log.read_text(encoding='utf-8',errors='replace')
 tests,passed,failed=c(output,'tests'),c(output,'pass'),c(output,'fail')
 status='passed' if rc==0 and not timed and tests>0 and tests==passed and failed==0 else 'failed'
 rec={'batch':name,'testFiles':files,'tests':tests,'passed':passed,'failed':failed,'runnerExitCode':rc,'timedOut':timed,'status':status,'path':str(log.relative_to(ROOT))}
 records.append(rec); print(json.dumps(rec),flush=True)
 if status!='passed':
  print(output[-10000:],file=sys.stderr); break
report={'version':'20.0','status':'passed' if len(records)==len(batches) and all(r['status']=='passed' for r in records) else 'failed','runner':'eight isolated serial subprocesses with hard timeouts','batches':records,'totals':{'testFiles':sum(len(r['testFiles']) for r in records),'tests':sum(r['tests'] for r in records),'passed':sum(r['passed'] for r in records),'failed':sum(r['failed'] for r in records)},'limitations':['Executed TAP summaries are counted; collection-only numbers are excluded.','Production isolation, PostgreSQL multi-host behavior and external security review are separate blocked gates.']}
(ROOT/'evidence/generated/V20_TEST_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report['totals']),flush=True)
raise SystemExit(0 if report['status']=='passed' else 1)
