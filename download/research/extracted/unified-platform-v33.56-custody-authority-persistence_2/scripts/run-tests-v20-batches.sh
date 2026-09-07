#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT=evidence/generated/v20-test-batches
mkdir -p "$OUT"
run_batch() {
  local name="$1"; local seconds="$2"; shift 2
  echo "[v20-test] $name"
  timeout --foreground --signal=TERM --kill-after=2s "${seconds}s" \
    node --test --test-concurrency=1 --test-force-exit "$@" > "$OUT/$name.log" 2>&1
}
run_batch canonical-core 45 \
  dist/tests/adapters.test.js dist/tests/backup-restore.test.js dist/tests/contracts.test.js \
  dist/tests/digital-thread.test.js dist/tests/durable.test.js dist/tests/failure-knowledge.test.js \
  dist/tests/integrated-engineering-commitment.test.js dist/tests/key-lifecycle.test.js \
  dist/tests/postgres-contract.test.js dist/tests/shadow-flow.test.js dist/tests/standards-adapters.test.js dist/tests/system-contracts.test.js
run_batch v20-governance-security 45 \
  dist/tests/governance-consistency.test.js dist/tests/encrypted-keystore.test.js dist/tests/private-identity.test.js dist/tests/private-pilot-context.test.js
run_batch v20-platform 55 \
  dist/tests/artifact-store.test.js dist/tests/governed-agent.test.js dist/tests/release-manifest.test.js \
  dist/tests/session-archiver.test.js dist/tests/source-adapters-v20.test.js dist/tests/telemetry.test.js
run_batch process 45 dist/tests/multiprocess.test.js
run_batch repository 55 dist/tests/repository-change.test.js
run_batch wasm 45 dist/tests/wasm-capability-runner.test.js dist/tests/wasm-isolation.test.js
run_batch linux-and-private-server 55 dist/tests/linux-isolation.test.js dist/tests/private-server-config.test.js
run_batch web 55 dist/tests/web-server.test.js dist/tests/web-workflow.test.js dist/tests/private-pilot-server.test.js
python3 - <<'PY'
from pathlib import Path
import json,re
root=Path.cwd(); out=root/'evidence/generated/v20-test-batches'
files_by_batch={
'canonical-core':12,'v20-governance-security':4,'v20-platform':6,'process':1,'repository':1,'wasm':2,'linux-and-private-server':2,'web':3}
def count(text,label):
 m=re.findall(rf'^# {re.escape(label)} (\d+)$',text,re.M); return int(m[-1]) if m else 0
records=[]
for name,nfiles in files_by_batch.items():
 path=out/f'{name}.log'; text=path.read_text(errors='replace')
 tests,passed,failed=count(text,'tests'),count(text,'pass'),count(text,'fail')
 status='passed' if tests>0 and tests==passed and failed==0 else 'failed'
 records.append({'batch':name,'testFileCount':nfiles,'tests':tests,'passed':passed,'failed':failed,'timedOut':False,'status':status,'path':str(path.relative_to(root))})
report={'version':'20.0','status':'passed' if all(r['status']=='passed' for r in records) else 'failed','runner':'eight shell-isolated serial lanes with hard timeouts','batches':records,'totals':{'testFiles':sum(r['testFileCount'] for r in records),'tests':sum(r['tests'] for r in records),'passed':sum(r['passed'] for r in records),'failed':sum(r['failed'] for r in records)},'limitations':['Executed TAP summaries are counted; collection-only numbers are excluded.','Production isolation, PostgreSQL multi-host behavior and external security review remain separate qualification gates.']}
(root/'evidence/generated/V20_TEST_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
raise SystemExit(0 if report['status']=='passed' else 1)
PY
