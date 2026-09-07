#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)
records=[]
for iteration in range(1,4):
    started=time.perf_counter()
    result=subprocess.run(['python3','scripts/run-tests-v23-batches.py'],cwd=ROOT,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':''},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
    report=json.loads((OUT/'V23_TEST_RESULTS.json').read_text()) if (OUT/'V23_TEST_RESULTS.json').exists() else {}
    records.append({'iteration':iteration,'exitCode':result.returncode,'durationMs':round((time.perf_counter()-started)*1000,3),'totals':report.get('totals',{}),'status':report.get('status','missing'),'outputTail':result.stdout[-2000:]})
report={'version':'23.0','status':'passed' if all(r['exitCode']==0 and r['status']=='passed' and r['totals'].get('tests')==229 and r['totals'].get('failed')==0 for r in records) else 'failed','runs':records,'flakeCount':sum(1 for r in records if r['exitCode']!=0 or r['status']!='passed'),'limitations':['Three repeated full sharded runs are evidence against observed flakiness, not proof that no flake exists.']}
(OUT/'V23_STABILITY_REPORT.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
raise SystemExit(0 if report['status']=='passed' else 1)
