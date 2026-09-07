#!/usr/bin/env python3
from __future__ import annotations
import json, math, os, signal, statistics, subprocess, time
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/generated'; OUT.mkdir(parents=True,exist_ok=True)

def utc(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def run_once(index:int)->dict:
    started=time.perf_counter(); log=OUT/f'v24-stability-run-{index}.log'
    process=subprocess.Popen(['python3','scripts/run-tests-v24-parallel.py'],cwd=ROOT,env={**os.environ,'NODE_ENV':'test','NODE_OPTIONS':'','V24_STABILITY_ITERATION':str(index)},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
    timed_out=False
    try: output,_=process.communicate(timeout=110)
    except subprocess.TimeoutExpired:
        timed_out=True; os.killpg(process.pid,signal.SIGTERM)
        try: output,_=process.communicate(timeout=3)
        except subprocess.TimeoutExpired: os.killpg(process.pid,signal.SIGKILL); output,_=process.communicate()
    log.write_text(output or '',encoding='utf-8')
    evidence={}
    path=OUT/'V24_TEST_RESULTS.json'
    if path.exists():
        try: evidence=json.loads(path.read_text())
        except Exception: evidence={}
    totals=evidence.get('totals',{})
    return {'iteration':index,'status':'passed' if process.returncode==0 and not timed_out and evidence.get('status')=='passed' else 'failed','exitCode':process.returncode,'timedOut':timed_out,'durationMs':round((time.perf_counter()-started)*1000,3),'testWallMs':totals.get('wallDurationMs'),'tests':totals.get('tests'),'passed':totals.get('passed'),'failed':totals.get('failed'),'log':str(log.relative_to(ROOT))}

def main()->int:
    runs=[run_once(index) for index in range(1,4)]
    walls=[float(run['testWallMs']) for run in runs if isinstance(run.get('testWallMs'),(int,float))]
    mean=statistics.fmean(walls) if walls else 0
    std=statistics.pstdev(walls) if len(walls)>1 else 0
    report={'version':'24.0','ownerRole':'Flakiness and Stability Investigator','status':'passed' if len(runs)==3 and all(run['status']=='passed' and run['tests']>=242 and run['failed']==0 for run in runs) else 'failed','startedAt':utc(),'runs':runs,'statistics':{'medianWallMs':round(statistics.median(walls),3) if walls else None,'meanWallMs':round(mean,3) if walls else None,'minWallMs':round(min(walls),3) if walls else None,'maxWallMs':round(max(walls),3) if walls else None,'coefficientOfVariation':round(std/mean,4) if mean else None},'flakeCount':sum(run['status']!='passed' for run in runs),'forceExitDisabled':True,'limitations':['Three consecutive local executions detect observed instability but do not establish long-term flake probability across operating systems and hardware.']}
    (OUT/'V24_STABILITY_REPORT.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'runs':[{'tests':r['tests'],'failed':r['failed'],'wallMs':r['testWallMs']} for r in runs],'statistics':report['statistics']},indent=2))
    return 0 if report['status']=='passed' else 1
if __name__=='__main__': raise SystemExit(main())
