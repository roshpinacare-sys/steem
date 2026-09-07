#!/usr/bin/env python3
import json,os,subprocess,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();samples=[]
for i in range(3):
 t=time.perf_counter();p=subprocess.run(['npm','run','build:incremental:v32.6'],cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env={**os.environ,'NODE_OPTIONS':''});samples.append({'sample':i+1,'durationMs':round((time.perf_counter()-t)*1000,3),'exitCode':p.returncode,'outputTail':p.stdout[-1000:]})
report={'version':'32.6.1','runId':OUT.name,'status':'passed'if all(x['exitCode']==0 and x['durationMs']<=3500 for x in samples)else'failed',**ctx.execution_identity(),'budgetMs':3500,'samples':samples,'allWithinBudget':all(x['durationMs']<=3500 for x in samples)};ctx.atomic_write_json(OUT/'V32_6_INCREMENTAL_BUILD_BENCHMARK.json',report);print(json.dumps(report,indent=2));raise SystemExit(0 if report['status']=='passed'else 1)
