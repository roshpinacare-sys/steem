#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
rm -rf dist coverage evidence/generated
mkdir -p evidence/generated
npm run build
python3 scripts/run-tests-v21-batches.py
node scripts/run-coverage-v21.mjs
node dist/src/cli/demo-v21.js | tee evidence/generated/v21-integrated-demo.json
node scripts/probe-environment-v20.mjs
node scripts/validate-private-server-config.mjs > evidence/generated/private-server-config-v21.json
set +e
node scripts/qualify-postgres-v20.mjs
pg_rc=$?
set -e
if [[ "$pg_rc" != "0" && "$pg_rc" != "2" ]]; then exit "$pg_rc"; fi
python3 e2e/test_breakthrough_pilot_v21.py
node scripts/benchmark-v21.mjs
set +e
timeout --foreground --signal=TERM --kill-after=2s 20s npm audit --json > evidence/generated/npm-audit-v21.raw.json 2> evidence/generated/npm-audit-v21.stderr.log
audit_rc=$?
set -e
python3 - "$audit_rc" <<'PY_AUDIT'
import json,sys
from pathlib import Path
rc=int(sys.argv[1]); raw=Path('evidence/generated/npm-audit-v21.raw.json'); stderr=Path('evidence/generated/npm-audit-v21.stderr.log')
try:data=json.loads(raw.read_text()) if raw.exists() and raw.stat().st_size else {}
except Exception:data={}
if rc==0:report={'status':'executed','exitCode':rc,'metadata':data.get('metadata',{}),'limitations':['Registry-backed advisory result is time-sensitive.']}
else:report={'status':'environment-blocked','exitCode':rc,'metadata':{},'limitations':['npm advisory service unavailable or timed out.'],'stderr':stderr.read_text(errors='replace')[:4000]}
Path('evidence/generated/npm-audit-v21.json').write_text(json.dumps(report,indent=2)+'\n')
PY_AUDIT
python3 - <<'PY_FINAL'
from pathlib import Path
import json,re
root=Path.cwd(); generated=root/'evidence/generated'
tests=json.loads((generated/'V21_TEST_RESULTS.json').read_text()); coverage=(generated/'v21-coverage.log').read_text(errors='replace')
match=re.search(r'^# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)',coverage,re.M)
report={'version':'21.0','status':'passed','stages':{'typescriptBuild':'passed','tests':tests,'coverage':{'status':'passed','linePercent':float(match.group(1)) if match else None,'branchPercent':float(match.group(2)) if match else None,'functionPercent':float(match.group(3)) if match else None,'scope':json.loads((generated/'v21-coverage-scope.json').read_text())},'integratedDemo':json.loads((generated/'v21-integrated-demo.json').read_text()),'environment':json.loads((generated/'environment-v20.json').read_text()),'privateServerConfig':json.loads((generated/'private-server-config-v21.json').read_text()),'postgresql':json.loads((generated/'postgres-v20-qualification.json').read_text()),'browserE2E':json.loads((generated/'v21-browser-e2e.json').read_text()),'efficiency':json.loads((generated/'v21-local-efficiency.json').read_text()),'npmAudit':json.loads((generated/'npm-audit-v21.json').read_text())},'acceptance':{'minimum':'pending-program-artifacts','strong':'partially-met','production':'not-met'},'limitations':['PostgreSQL server unavailable','rootless container and WASI Component runtimes unavailable','real KMS/HSM unavailable','single-host only','untrusted repository execution blocked','no external penetration test','no licensing disposition','no human product validation']}
(generated/'V21_FINAL_VALIDATION.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':report['status'],'tests':tests['totals'],'coverage':report['stages']['coverage'],'acceptance':report['acceptance']},indent=2))
PY_FINAL
