#!/usr/bin/env python3
from __future__ import annotations
import os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
run_id=os.getenv('V32_6_RUN_ID','v32.8-validation');env={**os.environ,'V32_6_RUN_ID':run_id}
steps=[
 ['npm','run','build:clean:v32'],
 ['python3','scripts/run-tests-v32_6.py','--mode','full','--no-build'],
 ['python3','scripts/run-strategic-adversarial-mutation-v32_8.py'],
 ['node','scripts/strategic-adversarial-cycle-v32_8.mjs'],
 ['node','scripts/run-coverage-v32.mjs'],
 ['node','scripts/test-quality-audit-v32.mjs'],
 ['node','scripts/architecture-validation-v32.mjs'],
 ['node','scripts/capture-v32_8-local-reports.mjs'],
 ['node','scripts/validate-v32_8.mjs'],
]
for step in steps:
 print('+',' '.join(step),flush=True);result=subprocess.run(step,cwd=ROOT,env=env)
 if result.returncode:raise SystemExit(result.returncode)
