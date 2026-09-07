#!/usr/bin/env bash
set -euo pipefail
python3 - "$@" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
keys=[p[k] for k in ['participantKeyId','registrarKeyId','custodianAKeyId','custodianBKeyId','verifierKeyId']]
assert len(keys)==len(set(keys)), 'role key overlap'
PY
