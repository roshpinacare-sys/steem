#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${1:?source path required}"
if [[ "$SOURCE" != /* ]]; then SOURCE="$ROOT/$SOURCE"; fi
[[ -f "$SOURCE" ]] || { echo "probe_source_missing:$SOURCE" >&2; exit 2; }
CACHE="$ROOT/.cache/linux-probes"
mkdir -p "$CACHE"
SOURCE_DIGEST="$(sha256sum "$SOURCE" | awk '{print $1}')"
COMPILER_ID="$(gcc --version | head -1)"
FLAGS='-O2 -Wall -Wextra -Werror -static'
KEY="$(printf '%s\n%s\n%s\n' "$SOURCE_DIGEST" "$COMPILER_ID" "$FLAGS" | sha256sum | awk '{print $1}')"
TARGET="$CACHE/$KEY/probe"
META="$CACHE/$KEY/metadata.json"
if [[ -x "$TARGET" && -s "$META" ]]; then
  python3 - "$META" "$SOURCE_DIGEST" "$COMPILER_ID" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); assert m['sourceDigest']==sys.argv[2] and m['compilerId']==sys.argv[3]
PY
  printf '%s\n' "$TARGET"
  exit 0
fi
LOCK="$CACHE/$KEY.lock"
for _ in $(seq 1 200); do
  if mkdir "$LOCK" 2>/dev/null; then break; fi
  if [[ -x "$TARGET" ]]; then printf '%s\n' "$TARGET"; exit 0; fi
  sleep .025
done
[[ -d "$LOCK" ]] || { echo "probe_cache_lock_timeout:$KEY" >&2; exit 3; }
trap 'rm -rf "$LOCK"' EXIT
if [[ ! -x "$TARGET" ]]; then
  TMP="$(mktemp -d -p "$CACHE" ".build-$KEY-XXXXXX")"
  gcc -O2 -Wall -Wextra -Werror -static "$SOURCE" -o "$TMP/probe"
  chmod 0555 "$TMP/probe"
  python3 - "$TMP/metadata.json" "$SOURCE" "$SOURCE_DIGEST" "$COMPILER_ID" "$FLAGS" <<'PY'
import json,sys,datetime,pathlib
pathlib.Path(sys.argv[1]).write_text(json.dumps({'version':'24.0','source':sys.argv[2],'sourceDigest':sys.argv[3],'compilerId':sys.argv[4],'flags':sys.argv[5],'compiledAt':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+'\n')
PY
  mkdir -p "$(dirname "$TARGET")"
  mv "$TMP/probe" "$TARGET"
  mv "$TMP/metadata.json" "$META"
  rmdir "$TMP"
fi
printf '%s\n' "$TARGET"
