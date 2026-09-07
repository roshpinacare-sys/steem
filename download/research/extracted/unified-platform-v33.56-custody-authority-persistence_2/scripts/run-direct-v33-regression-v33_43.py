#!/usr/bin/env python3
from __future__ import annotations
import json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
META=ROOT/'release-evidence/v33.43/V33_43_FULL_TEST_META.json'
OUT=ROOT/'release-evidence/v33.43/V33_43_DIRECT_V33_RESULTS.json'
meta=json.loads(META.read_text())
files=[]
for row in meta.get('files',[]):
    name=str(row.get('name',''))
    if '-v33_' in name:
        files.append({k:row.get(k) for k in ['name','exitCode','tests','passed','failed','timedOut','durationSeconds']})
files.sort(key=lambda x:x['name'])
totals={'testFiles':len(files),'tests':sum(int(x.get('tests') or 0) for x in files),'passed':sum(int(x.get('passed') or 0) for x in files),'failed':sum(int(x.get('failed') or 0) for x in files)}
valid=totals['testFiles']>0 and totals['tests']>0 and totals['passed']==totals['tests'] and totals['failed']==0 and all(x.get('exitCode')==0 and not x.get('timedOut') for x in files)
result={'version':'33.43','status':'passed' if valid else 'failed','runner':'derived-from-authoritative-one-process-per-test-file-receipts','independentProcessPerFile':True,'retry':False,'forceExit':False,'totals':totals,'files':files}
OUT.parent.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2));sys.exit(0 if valid else 1)
