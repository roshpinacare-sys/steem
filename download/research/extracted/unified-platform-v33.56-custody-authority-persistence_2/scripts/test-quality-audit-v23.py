#!/usr/bin/env python3
from __future__ import annotations
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
issues=[]; files=[]
for path in sorted((ROOT/'tests').glob('*.test.ts')):
    text=path.read_text(); tests=len(re.findall(r'\btest\s*\(',text)); assertions=len(re.findall(r'\bassert\.',text))
    record={'path':str(path.relative_to(ROOT)),'testsDeclared':tests,'assertCalls':assertions,'bytes':path.stat().st_size}
    files.append(record)
    if tests==0: issues.append({'severity':'high','path':record['path'],'issue':'no_test_declarations'})
    if assertions==0: issues.append({'severity':'high','path':record['path'],'issue':'no_assert_calls'})
    for pattern,name,severity in [(r'\btest\.(skip|todo|only)\b','hidden_or_focused_test','high'),(r'assert\.ok\(true\)','trivial_assertion','high'),(r'setTimeout\([^,]+,\s*0\)','zero_delay_timing_dependency','low')]:
        if re.search(pattern,text): issues.append({'severity':severity,'path':record['path'],'issue':name})
    if 'Math.random()' in text: issues.append({'severity':'informational','path':record['path'],'issue':'randomness_present_reviewed_for_identity_or_temp_path'})
critical=[i for i in issues if i['severity'] in ('critical','high')]
report={'version':'23.0','status':'passed' if not critical else 'failed','filesAudited':len(files),'testsDeclared':sum(f['testsDeclared'] for f in files),'assertCalls':sum(f['assertCalls'] for f in files),'criticalOrHighIssues':len(critical),'issues':issues,'files':files,'limitations':['Static audit does not replace mutation testing or execution provenance.']}
(ROOT/'evidence/generated/V23_TEST_QUALITY_AUDIT.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['status','filesAudited','testsDeclared','assertCalls','criticalOrHighIssues']},indent=2))
raise SystemExit(0 if report['status']=='passed' else 1)
