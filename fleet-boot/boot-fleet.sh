#!/usr/bin/env bash
# boot-fleet.sh — idempotent self-boot v2 (committed 2026-11-01, wipe-proof).
# Contract: after ANY wipe, running this file restores the full workspace:
#   /home/z/my-project/fleet/{steem,saos-dex,dev.log}  +  /home/z/fleet entry symlink.
# Self-healing: if the steem tree is gone, it re-clones THIS repo (saos-cockpit)
# and reinstalls the beat loop. Ends with "boot-fleet: entry=OK" or an honest error.
# Never prints key material; the askpass helper reads the local secret file.
set -u
PERSISTENT="/home/z/my-project/fleet"
ENTRY="/home/z/fleet"
KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_URL="https://github.com/roshpinacare-sys/steem.git"
BRANCH="saos-cockpit"
ASKPASS="$KIT_DIR/askpass.sh"

mkdir -p "$PERSISTENT" 2>/dev/null || true

# 1) Workspace content: steem tree + beat loop
if [ ! -f "$PERSISTENT/steem/mini-services/saos-engine/master-judge.mjs" ]; then
  rm -rf "$PERSISTENT/steem" 2>/dev/null || true
  GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 \
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$PERSISTENT/steem" 2>&1 | tail -1
fi
if [ ! -f "$PERSISTENT/steem/mini-services/saos-engine/master-judge.mjs" ]; then
  echo "boot-fleet: STEEM-TREE-UNAVAILABLE (clone failed; check token/network)"
  exit 1
fi
mkdir -p "$PERSISTENT/saos-dex" 2>/dev/null || true
cp -f "$KIT_DIR/saos-dex/beat-loop.sh" "$PERSISTENT/saos-dex/beat-loop.sh" 2>/dev/null || true
chmod +x "$PERSISTENT/saos-dex/beat-loop.sh" 2>/dev/null || true
touch "$PERSISTENT/dev.log" 2>/dev/null || true

# 2) Entry symlink
if [ ! -e "$ENTRY" ]; then
  rm -f "$ENTRY" 2>/dev/null || true
  ln -s "$PERSISTENT" "$ENTRY" 2>/dev/null || true
fi

# 3) Verify
if [ -e "$ENTRY/saos-dex/beat-loop.sh" ] && [ -f "$ENTRY/steem/mini-services/saos-engine/master-judge.mjs" ]; then
  echo "boot-fleet: entry=OK"
else
  echo "boot-fleet: entry=MISSING-CONTENT"
  exit 1
fi
