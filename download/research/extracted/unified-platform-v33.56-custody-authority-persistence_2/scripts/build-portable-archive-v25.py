#!/usr/bin/env python3
from pathlib import Path
import argparse,json
from archive_policy_v25 import build
p=argparse.ArgumentParser();p.add_argument('root');p.add_argument('target');p.add_argument('--report');a=p.parse_args()
r=build(Path(a.root),Path(a.target)); text=json.dumps(r,indent=2)+'\n'
if a.report: Path(a.report).write_text(text)
print(text,end='')
