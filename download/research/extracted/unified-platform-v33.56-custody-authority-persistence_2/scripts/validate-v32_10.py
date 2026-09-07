#!/usr/bin/env python3
from __future__ import annotations
import os,shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];run_id=os.environ.get('V32_6_RUN_ID','v32.10-final');out=ROOT/'evidence/runs'/run_id
if out.exists():shutil.rmtree(out)
out.mkdir(parents=True,exist_ok=True);env={**os.environ,'V32_6_RUN_ID':run_id,'V32_6_RUN_DIR':str(out),'NODE_ENV':'test','NODE_OPTIONS':''}
steps=[('clean-build',['npm','run','build:clean:v32']),('full',['python3','scripts/run-tests-v32_6.py','--mode','full','--no-build']),('local-mutation',['python3','scripts/run-local-assurance-mutation-v32_10.py']),('coverage',['node','scripts/run-coverage-v32.mjs']),('quality',['node','scripts/test-quality-audit-v32.mjs']),('architecture',['node','scripts/architecture-validation-v32.mjs']),('local-assurance',['node','scripts/local-assurance-cycle-v32_10.mjs']),('final',['node','scripts/validate-v32_10.mjs'])]
for label,cmd in steps:
 print(f'== {label} ==',flush=True);p=subprocess.run(cmd,cwd=ROOT,env=env)
 if p.returncode!=0:raise SystemExit(p.returncode)
print(out)
