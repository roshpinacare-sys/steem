#!/usr/bin/env bash
# SOVEREIGN BOOTSTRAP (R241) — reproduce the body from GIT alone.
# Law: docs/SANDBOX-DISTRUST-LAW.md §4.1 — proof: fresh clone == frozen selftest score.
# Usage: scripts/sovereign-bootstrap.sh [DEST_DIR]   (default: /tmp/saos-bootstrap-<ts>)
set -euo pipefail
DEST="${1:-/tmp/saos-bootstrap-$(date +%s)}"
BRANCH="saos-cockpit"
cd "$(dirname "$0")/.."

# --- resolve clone URL: prefer this checkout's origin, else PAT from upload/pat.env
URL="$(git config --get remote.origin.url || true)"
if [[ -z "${URL}" && -f upload/pat.env ]]; then
  # shellcheck disable=SC1091
  source upload/pat.env
  URL="https://roshpinacare-sys:${GITHUB_TOKEN}@github.com/roshpinacare-sys/steem.git"
fi
[[ -z "${URL}" ]] && { echo "BOOTSTRAP-FAIL: no clone URL (run inside a checkout or provide upload/pat.env)"; exit 1; }

echo "== 1/4 clone ${BRANCH} -> ${DEST}"
rm -rf "${DEST}"
git clone --depth 1 -b "${BRANCH}" "${URL}" "${DEST}" >/dev/null 2>&1

echo "== 2/4 engine install"
cd "${DEST}/mini-services/saos-engine"
bun install --frozen-lockfile >/dev/null 2>&1 || bun install >/dev/null 2>&1

echo "== 3/4 selftest (git-only reproduction gate)"
SELFTEST_OUT="$(node selftest.mjs 2>&1 | tail -1)"
echo "   ${SELFTEST_OUT}"
echo "${SELFTEST_OUT}" | rg -q "PASS" || { echo "BOOTSTRAP-FAIL: selftest did not PASS"; exit 2; }

echo "== 4/4 head-of-truth"
echo "   clone=${DEST}"
echo "   head=$(git -C "${DEST}" rev-parse HEAD)"
echo "   law=docs/SANDBOX-DISTRUST-LAW.md"
echo "BOOTSTRAP-OK — the brain reproduces from git alone. Start with: cd ${DEST}/mini-services/saos-engine && bun index.ts"
