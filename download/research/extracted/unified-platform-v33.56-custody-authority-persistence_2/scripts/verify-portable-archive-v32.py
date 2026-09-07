#!/usr/bin/env python3
from pathlib import Path
import argparse,json
from archive_policy_v32 import verify
p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('--report');a=p.parse_args()
r=verify(Path(a.archive));text=json.dumps(r,indent=2)+'\n'
if a.report: Path(a.report).write_text(text)
print(text,end='')
