#!/usr/bin/env bash
set -euo pipefail
python3 - "$@" <<'PY'
import json,sys,datetime
p=json.load(open(sys.argv[1])); now=datetime.datetime.now(datetime.timezone.utc)
for k in ('observedAt','gossipedAt'):
 t=datetime.datetime.fromisoformat(p[k].replace('Z','+00:00'))
 assert (now-t).total_seconds() <= 300, f'{k} stale'
PY
