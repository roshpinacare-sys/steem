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
# 1b) R362 · OFFLINE FALLBACK (2026-11-05, owner execution order): if the
# network clone fails but a local vault clone of the same branch survives
# (fleet-restore/vault-home), materialize the tree from it — additive copy,
# origin remains the source of truth once the network returns.
if [ ! -f "$PERSISTENT/steem/mini-services/saos-engine/master-judge.mjs" ]; then
  VAULT_TREE="/home/z/my-project/fleet-restore/vault-home"
  if [ -f "$VAULT_TREE/mini-services/saos-engine/master-judge.mjs" ]; then
    ( cd "$VAULT_TREE" && timeout 45 git fetch -q origin "$BRANCH" 2>/dev/null; \
      timeout 20 git -c advice.detachedHead=false checkout -q "$BRANCH" 2>/dev/null ) || true
    mkdir -p "$PERSISTENT/steem"
    cp -r "$VAULT_TREE/." "$PERSISTENT/steem/" 2>/dev/null || true
    rm -rf "$PERSISTENT/steem/.git" 2>/dev/null || true
    echo "boot-fleet: steem tree materialized from local vault clone (offline fallback)"
  fi
fi
if [ ! -f "$PERSISTENT/steem/mini-services/saos-engine/master-judge.mjs" ]; then
  echo "boot-fleet: STEEM-TREE-UNAVAILABLE (clone failed; check token/network)"
  exit 1
fi
mkdir -p "$PERSISTENT/saos-dex" 2>/dev/null || true
cp -f "$KIT_DIR/saos-dex/beat-loop.sh" "$PERSISTENT/saos-dex/beat-loop.sh" 2>/dev/null || true
chmod +x "$PERSISTENT/saos-dex/beat-loop.sh" 2>/dev/null || true
touch "$PERSISTENT/dev.log" 2>/dev/null || true

# 1.5) Secrets restore + policy reconcile (learned 2026-11-04: wipes revert
# exec-armed Gate-1 flags and vault .secrets snapshots; state-patch carries the
# owner-sanctioned POLICY flags (no key material, .gitignore enforces) so every
# boot re-applies them automatically. Keys are never touched by this block.)
if [ -d "$PERSISTENT/steem" ] && [ ! -d "$PERSISTENT/steem/.secrets" ]; then
  VAULT_SECRETS="/home/z/my-project/fleet-restore/vault-home/.secrets"
  if [ -d "$VAULT_SECRETS" ]; then
    cp -r "$VAULT_SECRETS" "$PERSISTENT/steem/.secrets" && chmod 700 "$PERSISTENT/steem/.secrets"
  fi
fi
STATE_PATCH="$KIT_DIR/state-patch/exec-armed.json"
apply_state_patch() {  # $1=patch $2=target - merge policy flags only
  python3 - "$1" "$2" <<'PYINNER' || return 1
import json, sys, datetime
src, dst = sys.argv[1], sys.argv[2]
patch = json.load(open(src)); live = json.load(open(dst))
for k in ('operator','policy','promo','curate','hyperGrid','redeploy','soldiers'):
    if k in patch: live[k] = patch[k]
live['armed'] = patch.get('armed', live.get('armed'))
live['recorded-at'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
json.dump(live, open(dst,'w'), indent=1)
PYINNER
}
if [ -f "$STATE_PATCH" ] && [ -f "$PERSISTENT/steem/.secrets/exec-armed.json" ]; then
  if apply_state_patch "$STATE_PATCH" "$PERSISTENT/steem/.secrets/exec-armed.json"; then
    echo "boot-fleet: state-patch applied (Gate-1 wipe-immune)"
  else
    echo "boot-fleet: state-patch FAILED (kept original flags)"
  fi
fi
# keep the vault snapshot in sync so it never goes stale again
VAULT_EXEC="/home/z/my-project/fleet-restore/vault-home/.secrets/exec-armed.json"
if [ -f "$STATE_PATCH" ] && [ -f "$VAULT_EXEC" ]; then
  apply_state_patch "$STATE_PATCH" "$VAULT_EXEC" >/dev/null 2>&1 || true
fi

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
