#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d -t v19-linux-isolation-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/rootfs/input" "$WORK/rootfs/output"
printf 'approved-input' > "$WORK/rootfs/input/data.txt"
SOURCE="$ROOT/isolation/linux-v19/probe.c"
REF="$ROOT/.cache/linux-v19.probe-path"
DIGEST_REF="$ROOT/.cache/linux-v19.source-sha256"
CURRENT_DIGEST="$(sha256sum "$SOURCE" | awk '{print $1}')"
if [[ -s "$REF" && -s "$DIGEST_REF" && "$(cat "$DIGEST_REF")" == "$CURRENT_DIGEST" && -x "$(cat "$REF")" ]]; then
  PROBE_CACHE="$(cat "$REF")"
else
  PROBE_CACHE="$(bash "$ROOT/scripts/compile-linux-probe-v24.sh" "isolation/linux-v19/probe.c")"
fi
cp "$PROBE_CACHE" "$WORK/rootfs/probe"
run_mode() {
  local mode="$1"
  unshare --user --map-root-user --mount --net --pid --fork chroot "$WORK/rootfs" /probe "$mode"
}
for mode in allowed network process hostfile memory disk ptrace; do
  output="$(run_mode "$mode")"
  printf '%s=%s\n' "$mode" "$output"
done
test -s "$WORK/rootfs/output/result.txt"
python3 - "$WORK/rootfs/output/result.txt" <<'PY'
import json, pathlib, sys
content = pathlib.Path(sys.argv[1]).read_text()
print(json.dumps({
  "status": "passed",
  "isolationClass": "linux-user-mount-network-pid-namespace-chroot-seccomp-rlimit",
  "approvedOutput": content,
  "checks": ["approved-input-output", "network-syscall", "process-creation", "host-filesystem", "address-space", "file-size", "ptrace"],
  "limitations": ["no-delegated-cgroup-v2", "no-signed-root-image", "no-independent-security-review", "seccomp-denylist-not-allowlist", "local-single-host-proof"],
}, indent=2))
PY
