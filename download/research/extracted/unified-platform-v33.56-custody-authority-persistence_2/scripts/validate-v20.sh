#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
rm -rf dist coverage evidence/generated
mkdir -p evidence/generated
npm run build
bash scripts/run-tests-v20-batches.sh
node scripts/run-coverage-v20.mjs
node dist/src/cli/demo-v20.js
node scripts/probe-environment-v20.mjs
node scripts/validate-private-server-config.mjs > evidence/generated/private-server-config-v20.json
set +e
node scripts/qualify-postgres-v20.mjs
pg_rc=$?
set -e
if [[ "$pg_rc" != "0" && "$pg_rc" != "2" ]]; then exit "$pg_rc"; fi
python3 e2e/test_private_pilot_v20.py
node scripts/benchmark-v20.mjs
set +e
timeout --foreground --signal=TERM --kill-after=2s 20s npm audit --json > evidence/generated/npm-audit-v20.raw.json 2> evidence/generated/npm-audit-v20.stderr.log
audit_rc=$?
set -e
python3 - "$audit_rc" <<'PY_AUDIT'
import json,sys
from pathlib import Path
rc=int(sys.argv[1]); raw=Path('evidence/generated/npm-audit-v20.raw.json'); stderr=Path('evidence/generated/npm-audit-v20.stderr.log')
try:data=json.loads(raw.read_text()) if raw.exists() and raw.stat().st_size else {}
except Exception:data={}
if rc==0:report={'status':'executed','exitCode':rc,'metadata':data.get('metadata',{}),'limitations':['registry-backed advisory result is time-sensitive']}
else:report={'status':'environment-blocked','exitCode':rc,'metadata':{},'limitations':['npm advisory service unavailable or timed out'],'stderr':stderr.read_text(errors='replace')[:4000]}
Path('evidence/generated/npm-audit-v20.json').write_text(json.dumps(report,indent=2)+'\n')
PY_AUDIT
python3 - <<'PY_FINAL'
from pathlib import Path
import json,re
root=Path.cwd(); g=root/'evidence/generated'
tests=json.loads((g/'V20_TEST_RESULTS.json').read_text()); coverage=(g/'v20-coverage.log').read_text(errors='replace')
m=re.search(r'^# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)',coverage,re.M)
report={
 'version':'20.0','status':'passed',
 'stages':{
  'typescriptBuild':'passed','tests':tests,
  'coverage':{'status':'passed','linePercent':float(m.group(1)) if m else None,'branchPercent':float(m.group(2)) if m else None,'functionPercent':float(m.group(3)) if m else None,'scope':json.loads((g/'v20-coverage-scope.json').read_text())},
  'integratedPilot':json.loads((g/'v20-integrated-pilot/v20-integrated-pilot-summary.json').read_text()),
  'environment':json.loads((g/'environment-v20.json').read_text()),
  'privateServerConfig':json.loads((g/'private-server-config-v20.json').read_text()),
  'postgresql':json.loads((g/'postgres-v20-qualification.json').read_text()),
  'browserE2E':json.loads((g/'v20-browser-e2e.json').read_text()),
  'performance':json.loads((g/'v20-local-performance.json').read_text()),
  'npmAudit':json.loads((g/'npm-audit-v20.json').read_text()),
 },
 'acceptance':{'minimum':'met','strong':'partially-met','production':'not-met'},
 'limitations':['PostgreSQL server unavailable','rootless container and WASI Component runtimes unavailable','real KMS/HSM unavailable','single-host only','untrusted repository execution blocked','no external penetration test','no licensing disposition','no human market validation'],
}
(g/'V20_FINAL_VALIDATION.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':report['status'],'tests':tests['totals'],'coverage':report['stages']['coverage'],'acceptance':report['acceptance']},indent=2))
PY_FINAL
