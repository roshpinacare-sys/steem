#!/usr/bin/env python3
import json,os,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();kind=sys.argv[1]if len(sys.argv)>1 else''
commands={'coverage':['node','scripts/run-coverage-v32.mjs'],'quality':['node','scripts/test-quality-audit-v32.mjs'],'architecture':['node','scripts/architecture-validation-v32.mjs']};sources={'coverage':ROOT/'evidence/generated/V32_COVERAGE_REPORT.json','quality':ROOT/'evidence/generated/V32_TEST_QUALITY_AUDIT.json','architecture':ROOT/'evidence/generated/V32_ARCHITECTURE_INTEGRITY.json'}
if kind not in commands:raise SystemExit('invalid_gate')
p=subprocess.run(commands[kind],cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env={**os.environ,'NODE_OPTIONS':'','NODE_ENV':'test'},timeout=300);print(p.stdout[-12000:]);source=sources[kind]
if p.returncode or not source.exists():raise SystemExit(p.returncode or 1)
report=json.loads(source.read_text());report.update({'version':'32.6.1','runId':OUT.name,**ctx.execution_identity()});target=OUT/source.name;ctx.atomic_write_json(target,report);raise SystemExit(0)
