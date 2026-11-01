#!/usr/bin/env bash
# boot-fleet.sh — idempotent self-boot for the sovereign grid (wipe-proof contract).
# Recreates the /home/z/fleet entry symlink to the persistent tree after any wipe.
# Master copy lives at vault-home/scripts/boot-fleet.sh (survives wipes); this
# working copy is re-materialized from it if this tree is ever re-cloned.
set -uo pipefail
FLEET=/home/z/my-project/fleet
VAULT=/home/z/my-project/fleet-restore/vault-home
TOKEN_FILE=/home/z/my-project/upload/Titi.secret

# 1) fleet tree (clone of saos-dex) — restore from GitHub if a wipe took it
if [ ! -f "$FLEET/beat-loop.sh" ]; then
  if [ -f "$VAULT/scripts/boot-fleet.sh" ] && [ -d "$FLEET" ]; then
    cp "$VAULT/scripts/boot-fleet.sh" "$FLEET/boot-fleet.sh" 2>/dev/null
  fi
  if [ ! -d "$FLEET" ] || [ ! -f "$FLEET/beat-loop.sh" ]; then
    rm -rf "$FLEET" 2>/dev/null
    if [ -f "$TOKEN_FILE" ]; then
      TOKEN=$(head -1 "$TOKEN_FILE" | tr -d ' \n\r')
      git clone -q --depth 1 "https://x-access-token:${TOKEN}@github.com/roshpinacare-sys/saos-dex.git" "$FLEET" 2>/dev/null \
        || mkdir -p "$FLEET"
    else
      mkdir -p "$FLEET"
    fi
    # re-materialize the boot script itself
    if [ -f "$VAULT/scripts/boot-fleet.sh" ]; then
      cp "$VAULT/scripts/boot-fleet.sh" "$FLEET/boot-fleet.sh"
      chmod +x "$FLEET/boot-fleet.sh"
    fi
  fi
fi

# 2) steem tree → persistent vault-home (judge + custody-vault + receipts survive wipes)
if [ "$(readlink "$FLEET/steem" 2>/dev/null)" != "$VAULT" ]; then
  rm -rf "$FLEET/steem" 2>/dev/null
  ln -sfn "$VAULT" "$FLEET/steem"
fi

# 3) entry symlink /home/z/fleet → persistent tree
if [ "$(readlink /home/z/fleet 2>/dev/null)" != "$FLEET" ] || [ ! -e /home/z/fleet ]; then
  rm -f /home/z/fleet 2>/dev/null
  ln -sfn "$FLEET" /home/z/fleet
fi

# 4) beat-job path compatibility: cron runs /home/z/fleet/saos-dex/beat-loop.sh
if [ "$(readlink "$FLEET/saos-dex" 2>/dev/null)" != "." ] || [ ! -e "$FLEET/saos-dex/beat-loop.sh" ]; then
  ln -sfn . "$FLEET/saos-dex"
fi

# 5) sanity: the beat must be reachable (both spellings)
if [ -f /home/z/fleet/beat-loop.sh ] && [ -f /home/z/fleet/saos-dex/beat-loop.sh ]; then
  echo "boot-fleet: entry=OK"
else
  echo "boot-fleet: entry=DEGRADED (beat-loop.sh unreachable at /home/z/fleet/beat-loop.sh)"
  exit 1
fi
