#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release-evidence/v33.13"
mkdir -p "$OUT"
rm -f "$OUT/V33_13_FULL_TEST_DONE" "$OUT/V33_13_FULL_TEST_EXIT.txt"
start_ns=$(date +%s%N)
mapfile -t files < <(find "$ROOT/dist/tests" -maxdepth 1 -type f -name '*.test.js' -print | sort)
set +e
node --test --test-concurrency=4 --test-reporter=tap "${files[@]}" > "$OUT/V33_13_FULL_TEST_STDOUT.tap" 2> "$OUT/V33_13_FULL_TEST_STDERR.log"
rc=$?
set -e
end_ns=$(date +%s%N)
echo "$rc" > "$OUT/V33_13_FULL_TEST_EXIT.txt"
python3 - "$OUT" "$start_ns" "$end_ns" "$rc" "${files[@]}" <<'PY'
import hashlib,json,re,sys
from pathlib import Path
out=Path(sys.argv[1]);start=int(sys.argv[2]);end=int(sys.argv[3]);rc=int(sys.argv[4]);files=sys.argv[5:]
sp=out/'V33_13_FULL_TEST_STDOUT.tap';ep=out/'V33_13_FULL_TEST_STDERR.log';stdout=sp.read_bytes();stderr=ep.read_bytes();text=stdout.decode('utf8','replace')
def mark(name):
 m=re.search(rf'^# {re.escape(name)} (\d+)\s*$',text,re.M);return int(m.group(1)) if m else None
meta={'version':'33.13','exitCode':rc,'durationSeconds':round((end-start)/1e9,3),'timedOut':False,'forceExitDisabled':True,'stdoutSha256':hashlib.sha256(stdout).hexdigest(),'stderrSha256':hashlib.sha256(stderr).hexdigest(),'testFileCount':len(files)}
(out/'V33_13_FULL_TEST_META.json').write_text(json.dumps(meta,indent=2)+'\n')
results={'version':'33.13','generatedAt':'2026-07-21T15:00:00.000Z','status':'passed' if rc==0 and mark('fail')==0 else 'failed','runner':'node-test-authoritative-detached-exit-receipt','command':['node','--test','--test-concurrency=4','--test-reporter=tap',*[str(Path(f).relative_to(Path.cwd())) if str(f).startswith(str(Path.cwd())) else str(f) for f in files]],'totals':{'testFiles':len(files),'tests':mark('tests'),'passed':mark('pass'),'failed':mark('fail')},'runnerExitCode':rc,'timedOut':False,'forceExitDisabled':True,'durationSeconds':meta['durationSeconds'],'stdoutEvidence':'release-evidence/v33.13/V33_13_FULL_TEST_STDOUT.tap','stderrEvidence':'release-evidence/v33.13/V33_13_FULL_TEST_STDERR.log','exitEvidence':'release-evidence/v33.13/V33_13_FULL_TEST_EXIT.txt','metaEvidence':'release-evidence/v33.13/V33_13_FULL_TEST_META.json','stdoutSha256':meta['stdoutSha256'],'stderrSha256':meta['stderrSha256'],'productionPromotion':'blocked'}
(out/'V33_13_FULL_TEST_RESULTS.json').write_text(json.dumps(results,indent=2)+'\n')
PY
touch "$OUT/V33_13_FULL_TEST_DONE"
exit "$rc"
