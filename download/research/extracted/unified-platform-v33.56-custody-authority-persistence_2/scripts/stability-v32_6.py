#!/usr/bin/env python3
from __future__ import annotations
import json,os,statistics,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();identity=ctx.execution_identity();full_path=OUT/'V32_6_FULL_TEST_RESULTS.json'
if not full_path.exists():raise SystemExit('authoritative_full_missing')
full=json.loads(full_path.read_text());fields=['sourceDigest','compiledArtifactDigest','testManifestDigest','testFilesDigest','packageLockDigest','environmentDigest']
if not all(full.get(k)==identity[k]for k in fields)or full.get('status')!='passed'or full.get('lifecycleLeakDetected'):raise SystemExit('authoritative_full_not_reusable')
runs=[{'index':1,'kind':'authoritative-full','tests':full['tests'],'passed':full['passed'],'failed':full['failed'],'wallDurationMs':full['wallDurationMs'],'status':full['status'],'forceExitEnabled':full['forceExitEnabled']}]
for i in [2,3]:
 d=OUT/f'stability-repeat-{i}';d.mkdir(exist_ok=True);env={**os.environ,'V32_6_RUN_ID':OUT.name,'V32_6_RUN_DIR':str(d)};p=subprocess.run(['python3','scripts/run-tests-v32_6.py','--mode','full','--no-build','--functional-repeat'],cwd=ROOT,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
 rp=d/'V32_6_FULL_TEST_RESULTS.json'
 if p.returncode or not rp.exists():print(p.stdout[-10000:],file=sys.stderr);raise SystemExit(p.returncode or 1)
 r=json.loads(rp.read_text());
 if not all(r.get(k)==identity[k]for k in fields):raise SystemExit('repeat_identity_mismatch')
 runs.append({'index':i,'kind':'functional-repeat','tests':r['tests'],'passed':r['passed'],'failed':r['failed'],'wallDurationMs':r['wallDurationMs'],'status':r['status'],'forceExitEnabled':r['forceExitEnabled'],'reapedAfterCompleteTap':r['reapedAfterCompleteTap']})
values=[r['wallDurationMs']for r in runs];mean=statistics.mean(values);cv=statistics.pstdev(values)/mean if mean else 0;flake=sum(r['status']!='passed'or r['failed']or r['passed']!=runs[0]['passed']for r in runs);report={'version':'32.6.1','runId':OUT.name,'status':'passed'if flake==0 and cv<=.08 else'failed',**identity,'runs':runs,'flakeCount':flake,'savedFullRuns':1,'statistics':{'meanWallMs':round(mean,3),'coefficientOfVariation':round(cv,4),'minWallMs':min(values),'maxWallMs':max(values)},'policy':{'authoritativeFullChecksLifecycle':True,'functionalRepeatsMayForceExit':True}};ctx.atomic_write_json(OUT/'V32_6_STABILITY_REPORT.json',report);print(json.dumps(report,indent=2));raise SystemExit(0 if report['status']=='passed'else 1)
