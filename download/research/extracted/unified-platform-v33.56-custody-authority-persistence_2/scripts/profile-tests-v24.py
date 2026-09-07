#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
source=json.loads((ROOT/'evidence/generated/V24_TEST_RESULTS.json').read_text())
lanes=sorted(source['lanes'],key=lambda item:item['durationMs'],reverse=True)
wall=source['totals']['wallDurationMs']; serial=source['totals']['serialLaneDurationMs']; baseline=23157.508
slow=[{'lane':x['lane'],'durationMs':x['durationMs'],'tests':x['tests'],'testFiles':x['testFiles'],'shareOfWall':round(x['durationMs']/wall,4)} for x in lanes[:8]]
report={'version':'24.0','status':'passed' if source['status']=='passed' and source['totals']['tests']>=229 else 'failed','baseline':{'v23SerialTestStageMs':baseline,'tests':229,'testFiles':47},'current':{'wallMs':wall,'serialLaneMs':serial,'tests':source['totals']['tests'],'testFiles':source['totals']['testFiles'],'workers':source['workerLimit'],'capacity':source.get('capacityLimit'),'maxParallel':source['totals']['maxParallelLanes']},'improvement':{'speedupVsV23SerialStage':round(baseline/wall,3),'savedMs':round(baseline-wall,3),'testIncrease':source['totals']['tests']-229,'testFileIncrease':source['totals']['testFiles']-47,'parallelEfficiency':round(serial/(wall*source['totals']['maxParallelLanes']),4)},'slowestLanes':slow,'recommendations':[{'priority':1,'action':'Keep repository tests split across isolated files; retain four-file concurrency.','evidence':'repository lane is the dominant critical path.'},{'priority':2,'action':'Reuse source-keyed Linux probe artifacts during a validation run.','evidence':'Three isolation generations otherwise repeat static compilation.'},{'priority':3,'action':'Run impact-selected tests only for developer feedback; require the full suite for release.','evidence':'Conservative fallback prevents unknown changes from escaping.'}],'limitations':['Host contention changes lane duration; compare repeated medians before changing budgets.','Parallel speedup is not a reliability or production-readiness claim.']}
(ROOT/'evidence/generated/V24_TEST_PERFORMANCE_PROFILE.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report['improvement'],indent=2));raise SystemExit(0 if report['status']=='passed' else 1)
