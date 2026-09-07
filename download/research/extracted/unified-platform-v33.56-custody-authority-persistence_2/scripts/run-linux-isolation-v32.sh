#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/evidence/generated"
RAW="$ROOT/evidence/generated/v32-linux-isolation.raw.log"
bash "$ROOT/scripts/run-linux-isolation-v23.sh" | tee "$RAW"
python3 - "$RAW" "$ROOT/evidence/generated/V32_LINUX_ISOLATION.json" <<'PY'
import json, pathlib, sys
raw=pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
start=raw.rfind('\n{')
if start < 0:
    start=raw.find('{')
else:
    start += 1
if start < 0:
    raise SystemExit('isolation_json_missing')
report=json.loads(raw[start:])
report['version']='27.0'
report['ownerRole']='Capability Isolation Reviewer'
report['status']='passed-single-host-research-proof' if report.get('status')=='passed' else 'failed'
report['productionQualified']=False
report['nextAction']='Run independent security review and target-kernel/container qualification before any untrusted production execution.'
pathlib.Path(sys.argv[2]).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':report['status'],'checks':len(report.get('checks',[])),'limitations':report.get('limitations',[])},indent=2))
PY
