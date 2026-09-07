#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release-evidence/v33.16"
mkdir -p "$OUT"
rm -f "$OUT/V33_16_FULL_TEST_DONE" "$OUT/V33_16_FULL_TEST_EXIT.txt"
mapfile -t legacy_files < <(find "$ROOT/dist/tests" -maxdepth 1 -type f -name '*.test.js' ! -name 'proof-carrying-adaptive-execution-v33_15.test.js' ! -name 'persistent-adaptive-policy-controller-v33_16.test.js' ! -name 'multi-file-engineering-campaign-v33_9.test.js' -print | sort)
git_file="$ROOT/dist/tests/multi-file-engineering-campaign-v33_9.test.js"
adaptive_file="$ROOT/dist/tests/proof-carrying-adaptive-execution-v33_15.test.js"
controller_file="$ROOT/dist/tests/persistent-adaptive-policy-controller-v33_16.test.js"
start_ns=$(date +%s%N)
set +e
node --test --test-concurrency=2 --test-reporter=tap "${legacy_files[@]}" > "$OUT/V33_16_LEGACY_LANE_STDOUT.tap" 2> "$OUT/V33_16_LEGACY_LANE_STDERR.log"
legacy_rc=$?
node --test --test-concurrency=1 --test-reporter=tap "$git_file" > "$OUT/V33_16_GIT_LANE_STDOUT.tap" 2> "$OUT/V33_16_GIT_LANE_STDERR.log"
git_rc=$?
node --test --test-concurrency=1 --test-reporter=tap "$adaptive_file" > "$OUT/V33_16_ADAPTIVE_LANE_STDOUT.tap" 2> "$OUT/V33_16_ADAPTIVE_LANE_STDERR.log"
adaptive_rc=$?
node --test --test-concurrency=1 --test-reporter=tap "$controller_file" > "$OUT/V33_16_CONTROLLER_LANE_STDOUT.tap" 2> "$OUT/V33_16_CONTROLLER_LANE_STDERR.log"
controller_rc=$?
set -e
end_ns=$(date +%s%N)
rc=0
if [ "$legacy_rc" -ne 0 ] || [ "$git_rc" -ne 0 ] || [ "$adaptive_rc" -ne 0 ] || [ "$controller_rc" -ne 0 ]; then rc=1; fi
echo "$rc" > "$OUT/V33_16_FULL_TEST_EXIT.txt"
python3 - "$OUT" "$start_ns" "$end_ns" "$rc" "$legacy_rc" "$git_rc" "$adaptive_rc" "$controller_rc" "${legacy_files[@]}" "$git_file" "$adaptive_file" "$controller_file" <<'PY'
import hashlib,json,re,sys
from pathlib import Path
out=Path(sys.argv[1]);start=int(sys.argv[2]);end=int(sys.argv[3]);rc=int(sys.argv[4]);legacy_rc=int(sys.argv[5]);git_rc=int(sys.argv[6]);adaptive_rc=int(sys.argv[7]);controller_rc=int(sys.argv[8]);files=sys.argv[9:]
def parse(path):
 data=path.read_bytes(); text=data.decode('utf8','replace')
 def mark(name):
  m=re.search(rf'^# {re.escape(name)} (\d+)\s*$',text,re.M);return int(m.group(1)) if m else None
 return data,{'tests':mark('tests'),'passed':mark('pass'),'failed':mark('fail')}
paths={
 'legacy':(out/'V33_16_LEGACY_LANE_STDOUT.tap',out/'V33_16_LEGACY_LANE_STDERR.log'),
 'git':(out/'V33_16_GIT_LANE_STDOUT.tap',out/'V33_16_GIT_LANE_STDERR.log'),
 'adaptive':(out/'V33_16_ADAPTIVE_LANE_STDOUT.tap',out/'V33_16_ADAPTIVE_LANE_STDERR.log'),
 'controller':(out/'V33_16_CONTROLLER_LANE_STDOUT.tap',out/'V33_16_CONTROLLER_LANE_STDERR.log')}
parsed={k:parse(v[0]) for k,v in paths.items()}
combined_out=parsed['legacy'][0]+b'\n# --- V33.9 Git fixture isolated lane ---\n'+parsed['git'][0]+b'\n# --- V33.15 adaptive isolated lane ---\n'+parsed['adaptive'][0]+b'\n# --- V33.16 controller isolated lane ---\n'+parsed['controller'][0]
combined_err=paths['legacy'][1].read_bytes()+b'\n'+paths['git'][1].read_bytes()+b'\n'+paths['adaptive'][1].read_bytes()+b'\n'+paths['controller'][1].read_bytes()
(out/'V33_16_FULL_TEST_STDOUT.tap').write_bytes(combined_out);(out/'V33_16_FULL_TEST_STDERR.log').write_bytes(combined_err)
lanes=[
 {'name':'legacy-core','concurrency':2,'exitCode':legacy_rc,'testFiles':len(files)-3,**parsed['legacy'][1]},
 {'name':'git-fixture-v33.9','concurrency':1,'exitCode':git_rc,'testFiles':1,**parsed['git'][1]},
 {'name':'adaptive-v33.15','concurrency':1,'exitCode':adaptive_rc,'testFiles':1,**parsed['adaptive'][1]},
 {'name':'controller-v33.16','concurrency':1,'exitCode':controller_rc,'testFiles':1,**parsed['controller'][1]}]
meta={'version':'33.16','exitCode':rc,'durationSeconds':round((end-start)/1e9,3),'timedOut':False,'forceExitDisabled':True,'stdoutSha256':hashlib.sha256(combined_out).hexdigest(),'stderrSha256':hashlib.sha256(combined_err).hexdigest(),'testFileCount':len(files),'topology':'legacy-core-concurrency-2-plus-git-v33.9-v33.15-v33.16-isolated-concurrency-1','lanes':lanes}
(out/'V33_16_FULL_TEST_META.json').write_text(json.dumps(meta,indent=2)+'\n')
totals={'testFiles':len(files),'tests':sum((x.get('tests') or 0) for x in [parsed['legacy'][1],parsed['git'][1],parsed['adaptive'][1],parsed['controller'][1]]),'passed':sum((x.get('passed') or 0) for x in [parsed['legacy'][1],parsed['git'][1],parsed['adaptive'][1],parsed['controller'][1]]),'failed':sum((x.get('failed') or 0) for x in [parsed['legacy'][1],parsed['git'][1],parsed['adaptive'][1],parsed['controller'][1]])}
results={'version':'33.16','generatedAt':'2026-07-21T21:00:00.000Z','status':'passed' if rc==0 and totals['failed']==0 else 'failed','runner':'node-test-four-lane-authoritative-exit-receipt','testTopologyReason':'The stable core lane runs at concurrency 2. The V33.9 Git fixture suite and V33.15/V33.16 adaptive stateful suites run independently at concurrency 1 to remove scheduler-order coupling. No retry or force-exit is used.','totals':totals,'runnerExitCode':rc,'timedOut':False,'forceExitDisabled':True,'durationSeconds':meta['durationSeconds'],'stdoutEvidence':'release-evidence/v33.16/V33_16_FULL_TEST_STDOUT.tap','stderrEvidence':'release-evidence/v33.16/V33_16_FULL_TEST_STDERR.log','exitEvidence':'release-evidence/v33.16/V33_16_FULL_TEST_EXIT.txt','metaEvidence':'release-evidence/v33.16/V33_16_FULL_TEST_META.json','stdoutSha256':meta['stdoutSha256'],'stderrSha256':meta['stderrSha256'],'lanes':lanes,'productionPromotion':'blocked'}
(out/'V33_16_FULL_TEST_RESULTS.json').write_text(json.dumps(results,indent=2)+'\n')
PY
touch "$OUT/V33_16_FULL_TEST_DONE"
exit "$rc"
