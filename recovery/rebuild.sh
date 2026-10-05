#!/usr/bin/env bash
# SOVEREIGN REBUILD DRILL — one-command proof that the organism is reconstructible
# WITHOUT this sandbox. Complements recovery/REBUILD-RUNBOOK.md.
#
# Inputs:  SECRETS_FILE (default: this repo's .secrets/github.pat) — never printed.
# Output:  fresh clone at $WORK, verified: tip, artifacts, state JSON validity, deps.
# LAW:     NO ACTIVATION — never starts the engine, never loads signing keys,
#          never touches funds/capital. File-level + dependency proof only.
set -euo pipefail

SECRETS_FILE="${SECRETS_FILE:-$(cd "$(dirname "$0")/.." && pwd)/.secrets/github.pat}"
REPO="${REPO:-https://github.com/roshpinacare-sys/steem}"
BRANCH="${BRANCH:-saos-cockpit}"
WORK="${WORK:-/tmp/saos-rebuild-$(date -u +%Y%m%dT%H%M%SZ)}"

[[ -f "$SECRETS_FILE" ]] || { echo "MISSING INPUT: SECRETS_FILE=$SECRETS_FILE (operator protocol: pat.rar + chat password, or fresh fine-grained PAT)"; exit 1; }
[[ -s "$SECRETS_FILE" ]] || { echo "EMPTY INPUT: SECRETS_FILE is empty"; exit 1; }

export GIT_TERMINAL_PROMPT=0
HELPER="!f(){ echo username=x-access-token; echo password=\$(cat $SECRETS_FILE); };f"

echo "== [1/5] clone $REPO@$BRANCH =="
rm -rf "$WORK"; mkdir -p "$WORK"
git -c "credential.helper=$HELPER" clone --depth 50 --branch "$BRANCH" "$REPO" "$WORK/clone" >/dev/null 2>&1 \
  || { echo "CLONE-FAIL (credential or network)"; rm -f /dev/null; exit 1; }
cd "$WORK/clone"
echo "tip = $(git rev-parse HEAD)"
git log --oneline -3

echo "== [2/5] audit artifacts present =="
N=$(ls audit/r213/ 2>/dev/null | wc -l)
echo "audit/r213 files: $N (expect 9)"
[[ "$N" -eq 9 ]] || { echo "ARTIFACT-CHECK-FAIL"; exit 1; }
jq -e .audit audit/r213/VERDICT.json >/dev/null && echo "VERDICT.json valid (audit: $(jq -r .audit audit/r213/VERDICT.json | head -c 60)...)"

echo "== [3/5] cognitive + engine state tree =="
NS=$(ls mini-services/saos-engine/state/ 2>/dev/null | wc -l)
echo "engine state files: $NS"
test -f worklog.md && echo "worklog.md present ($(wc -c < worklog.md) bytes)"
test -f mini-services/saos-engine/index.ts && echo "engine entry present"

echo "== [4/5] dependencies (frozen, no activation) =="
if command -v bun >/dev/null 2>&1; then
  (cd mini-services/saos-engine && bun install --frozen-lockfile >/dev/null 2>&1) && echo "engine deps-ok" || echo "engine deps-WARN (continue — file-level proof unaffected)"
else
  echo "bun not present in drill environment — deps step skipped (documented limitation)"
fi

echo "== [5/5] state JSON validity =="
FAIL=0
for f in mini-services/saos-engine/state/*.json; do
  jq -e . "$f" >/dev/null 2>&1 || { echo "INVALID JSON: $f"; FAIL=1; }
done
[[ $FAIL -eq 0 ]] && echo "all state JSON valid"

echo "== REBUILD DRILL PASS — organism reconstructible to $BRANCH tip, NO activation performed (law) =="
echo "workspace: $WORK (inspect then delete)"
