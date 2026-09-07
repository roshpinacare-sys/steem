#!/usr/bin/env python3
from __future__ import annotations
import os, shutil, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RUN_ID=os.getenv("V32_7_RUN_ID","v32.7-final")
RUN_DIR=(ROOT/"evidence/runs"/RUN_ID).resolve()
def run(cmd,env=None):
 print("+"," ".join(cmd),flush=True)
 p=subprocess.run(cmd,cwd=ROOT,env={**os.environ,**(env or {})})
 if p.returncode: raise SystemExit(p.returncode)
if RUN_DIR.exists(): shutil.rmtree(RUN_DIR)
base=["python3","scripts/validate-test-operations-v32_6.py","--run-id",RUN_ID]
run(base+["--initialize"])
for stage in ["build-benchmark","profile","core","quick","full","qualification","mutation","stability","coverage","quality","architecture","throughput"]:
 run(base+["--stage",stage])
run(base+["--finalize"])
env={"V32_6_RUN_ID":RUN_ID,"V32_6_RUN_DIR":str(RUN_DIR)}
run(["python3","scripts/run-proof-integration-mutation-v32_7.py"],env)
run(["node","scripts/proof-integration-cycle-v32_7.mjs"],env)
run(["node","scripts/validate-v32_7.mjs"],env)
