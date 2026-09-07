#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d -t v20-linux-isolation-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/rootfs/input" "$WORK/rootfs/output"
printf 'approved-input' > "$WORK/rootfs/input/data.txt"
SOURCE="$ROOT/isolation/linux-v20/probe.c"
REF="$ROOT/.cache/linux-v20.probe-path"
DIGEST_REF="$ROOT/.cache/linux-v20.source-sha256"
CURRENT_DIGEST="$(sha256sum "$SOURCE" | awk '{print $1}')"
if [[ -s "$REF" && -s "$DIGEST_REF" && "$(cat "$DIGEST_REF")" == "$CURRENT_DIGEST" && -x "$(cat "$REF")" ]]; then
  PROBE_CACHE="$(cat "$REF")"
else
  PROBE_CACHE="$(bash "$ROOT/scripts/compile-linux-probe-v24.sh" "isolation/linux-v20/probe.c")"
fi
cp "$PROBE_CACHE" "$WORK/rootfs/probe"
chmod 0555 "$WORK/rootfs" "$WORK/rootfs/input" "$WORK/rootfs/probe"
chmod 0444 "$WORK/rootfs/input/data.txt"
chmod 0770 "$WORK/rootfs/output"
sha256sum "$WORK/rootfs/probe" "$WORK/rootfs/input/data.txt" > "$WORK/rootfs-manifest.sha256"
sha256sum -c "$WORK/rootfs-manifest.sha256" >/dev/null
run_mode() {
  local mode="$1"
  unshare --user --map-root-user --mount --net --pid --fork chroot "$WORK/rootfs" /probe "$mode"
}
for mode in allowed network process hostfile memory disk ptrace; do
  output="$(run_mode "$mode")"
  printf '%s=%s\n' "$mode" "$output"
done
test -s "$WORK/rootfs/output/result.txt"
python3 - "$WORK/rootfs/output/result.txt" "$WORK/rootfs-manifest.sha256" <<'PY'
import hashlib,json,pathlib,sys
result=pathlib.Path(sys.argv[1]).read_text(); manifest=pathlib.Path(sys.argv[2]).read_text()
print(json.dumps({
  'status':'passed','isolationClass':'linux-user-mount-network-pid-namespace-chroot-seccomp-rlimit-v20',
  'approvedOutput':result,'rootManifestDigest':hashlib.sha256(manifest.encode()).hexdigest(),
  'checks':['immutable-input-permissions','root-manifest','approved-input-output','network-syscall','process-creation','host-filesystem','address-space','file-size','ptrace'],
  'limitations':['cgroup-v1-environment-no-delegated-v2','no-container-image','no-independent-security-review','seccomp-denylist-not-allowlist','single-host-research-proof'],
},indent=2))
PY
