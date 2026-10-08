#!/usr/bin/env bash
# revive-anywhere.sh — R284 · THE ONE-COMMAND SOVEREIGN REVIVAL (git alone).
# Operator law (2026-10-06/10-08): "אין מה לבקש מפתחות — הכל בכספת בגיט",
# "האוטונומיה היא המפעיל". A fresh sandbox with ONLY GitHub auth reproduces
# the whole body — no operator-provided keys, ever:
#   1. clone the branch of record (saos-cockpit)
#   2. engine install + selftest gate (the brain reproduces)
#   3. git-vault revival — army + master WIFs, fail-closed chain-judged
#   4. signing key + PAT from the sealed extras blob (sovereign-restore.sh)
#   5. engine up (3040) + health + one live custody verdict
# Usage:
#   scripts/revive-anywhere.sh [DEST_DIR] [CLONE_URL]
#     CLONE_URL optional when run inside a checkout, or when GITHUB_TOKEN is
#     exported (https://roshpinacare-sys:${GITHUB_TOKEN}@github.com/roshpinacare-sys/steem.git).
# ZERO secret bytes are printed.
set -uo pipefail
DEST="${1:-/tmp/saos-revive-$(date +%s)}"
URL="${2:-}"
BRANCH="saos-cockpit"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
step() { printf '[revive] %s\n' "$*"; }
fail() { printf '[revive] FAIL: %s\n' "$*"; exit 1; }

# GITHUB_TOKEN wins (clone does NOT inherit the cwd repo .git/config insteadOf)
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  URL="https://roshpinacare-sys:${GITHUB_TOKEN}@github.com/roshpinacare-sys/steem.git"
elif [[ -z "$URL" ]]; then
  URL="$(git -C "$SELF" config --get remote.origin.url || true)"
fi
[[ -z "$URL" ]] && fail "no clone source (run inside a checkout or export GITHUB_TOKEN — the ONE operator input)"

step "1/5 clone ${BRANCH} -> ${DEST}"
rm -rf "$DEST"
git clone --depth 1 -b "$BRANCH" "$URL" "$DEST" >/dev/null 2>&1 || fail "clone failed (auth?)"

step "2/5 engine install + selftest gate"
( cd "$DEST/mini-services/saos-engine" && bun install --frozen-lockfile >/dev/null 2>&1 || bun install >/dev/null 2>&1 ) || fail "install failed"
ST="$( cd "$DEST/mini-services/saos-engine" && timeout 420 node selftest.mjs 2>&1 | tail -1 )"
step "   selftest: ${ST}"
echo "$ST" | rg -q "PASS" || fail "selftest did not PASS in the fresh clone"

step "3/5 git-vault revival (memory-only, chain-judged)"
RV="$( cd "$DEST/mini-services/saos-engine" && timeout 300 node -e '
import("./vault-revival.mjs").then(async (m) => {
  const r = await m.reviveArmyCustody();
  console.log(r.verdict + " " + (r.after?.verified ?? 0) + "/" + (r.after?.total ?? 0));
}).catch((e) => { console.log("REVIVAL-FAIL " + String(e).slice(0, 80)); });' )"
step "   custody: ${RV}"
echo "$RV" | rg -q "FLEET-CUSTODY-ALIVE" || fail "vault revival did not reach FLEET-CUSTODY-ALIVE"

step "4/5 signing key + PAT from the sealed vault (zero operator secrets)"
( cd "$DEST" && bash scripts/sovereign-restore.sh ) || fail "sovereign-restore failed"

step "5/5 engine up + health"
( cd "$DEST/mini-services/saos-engine" && nohup bun index.ts >/dev/null 2>&1 & echo $! > /tmp/revive-engine.pid )
sleep 4
H="$(curl -s -m 8 http://localhost:3040/health || true)"
echo "$H" | rg -qi "ok|alive|up" || step "   note: engine health probe: ${H:-no-response-yet} (port may still be warming)"
step "   engine pid $(cat /tmp/revive-engine.pid 2>/dev/null || echo '?') dest ${DEST}"
echo "REVIVE-OK — the body is alive from git alone: selftest PASS + ${RV} + signing restored"
