#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release-evidence/v33.7"
mkdir -p "$OUT"
rm -f "$OUT/V33_7_FULL_TEST_DONE" "$OUT/V33_7_FULL_TEST_EXIT.txt"
start_ns=$(date +%s%N)
set +e
node --test --test-concurrency=4 --test-reporter=tap "$ROOT"/dist/tests/*.test.js > "$OUT/V33_7_FULL_TEST_STDOUT.tap" 2> "$OUT/V33_7_FULL_TEST_STDERR.log"
rc=$?
set -e
end_ns=$(date +%s%N)
echo "$rc" > "$OUT/V33_7_FULL_TEST_EXIT.txt"
python3 - "$OUT" "$start_ns" "$end_ns" "$rc" <<'PY'
import hashlib,json,sys
from pathlib import Path
out=Path(sys.argv[1]); start=int(sys.argv[2]); end=int(sys.argv[3]); rc=int(sys.argv[4])
stdout=(out/'V33_7_FULL_TEST_STDOUT.tap').read_bytes(); stderr=(out/'V33_7_FULL_TEST_STDERR.log').read_bytes()
meta={'version':'33.7','exitCode':rc,'durationSeconds':round((end-start)/1_000_000_000,3),'timedOut':False,'forceExitDisabled':True,'stdoutSha256':hashlib.sha256(stdout).hexdigest(),'stderrSha256':hashlib.sha256(stderr).hexdigest()}
(out/'V33_7_FULL_TEST_META.json').write_text(json.dumps(meta,indent=2)+'\n')
PY
touch "$OUT/V33_7_FULL_TEST_DONE"
