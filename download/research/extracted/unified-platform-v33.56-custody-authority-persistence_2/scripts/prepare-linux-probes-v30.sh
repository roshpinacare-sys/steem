#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/.cache/linux-probes"
pids=()
for source in isolation/linux-v19/probe.c isolation/linux-v20/probe.c isolation/linux-v23/probe.c; do
  name="$(basename "$(dirname "$source")")"
  bash "$ROOT/scripts/compile-linux-probe-v24.sh" "$source" > "$ROOT/.cache/$name.probe-path" &
  sha256sum "$ROOT/$source" | awk '{print $1}' > "$ROOT/.cache/$name.source-sha256"
  pids+=("$!")
done
status=0
for pid in "${pids[@]}"; do wait "$pid" || status=$?; done
[[ $status -eq 0 ]] || exit "$status"
python3 - "$ROOT/.cache" <<'PY'
import json,pathlib,sys,hashlib
root=pathlib.Path(sys.argv[1]); rows=[]
for p in sorted(root.glob('linux-*.probe-path')):
    target=pathlib.Path(p.read_text().strip())
    rows.append({'sourceClass':p.stem.removesuffix('.probe-path'),'path':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size})
out=root.parent/'evidence/generated/V30_LINUX_PROBE_CACHE.json'; out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps({'version':'27.0','status':'prepared','probes':rows,'classification':'source-and-compiler-keyed-local-build-cache'},indent=2)+'\n')
print(json.dumps({'status':'prepared','probes':len(rows)}))
PY
