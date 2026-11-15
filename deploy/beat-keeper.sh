#!/bin/bash
# BEAT-KEEPER (sovereign engine, git-resident since wipe-26 2026-11-15) — the
# machine-local ONLINE heartbeat for steem@saos-cockpit mini-services/saos-engine.
#
# WAS local-only (/home/z/audit/beat-keeper.sh) and died with every wipe; now
# lives IN the engine branch so any fresh sandbox rebuilds it from git alone
# (same law as dex-beat-keeper.sh in saos-dex). The cloud beat (saos-runtime
# sovereign-runtime.yml, 30-min cron, SAOS_OFFLINE=1) stays the wipe-proof
# primary — THIS layer adds the one thing the cloud cannot have: the LIVE
# BRIDGE (SAOS_AI_BRIDGE → the desk's z-ai provider), because the fresh-draft
# writers' room only exists where the LLM provider is reachable.
#
# usage: bash deploy/beat-keeper.sh   (from the engine repo root; no secrets inside)
set -u
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 1

# 0) one beat at a time — any caller, any layer
exec 9>/tmp/sovereign-beat-keeper.lock
flock -n 9 || { echo "[beat-keeper] another keeper holds the lock — honest skip"; exit 0; }

# 0.5) engine branch only (the beat's state home is saos-cockpit)
if [ "$(git branch --show-current)" != "saos-cockpit" ]; then
  echo "[beat-keeper] HEAD is not saos-cockpit — honest skip (branch-hardening)"
  exit 0
fi

# 1) the canonical home is canonical — start from it (reconcile ladder, no force)
if ! git pull --ff-only -q origin saos-cockpit 2>/dev/null; then
  if git stash -q 2>/dev/null && git pull --rebase -q -X theirs origin saos-cockpit 2>/dev/null && git stash pop -q 2>/dev/null; then
    echo "[beat-keeper] ff race — reconciled via rebase -X theirs (the clock never skips for a race)"
  else
    git stash pop -q 2>/dev/null
    echo "[beat-keeper] pull failed — skipping beat (honest, no force)"
    exit 0
  fi
fi

# 2) engine deps (a fresh clone has no node_modules — measured law)
ENG="mini-services/saos-engine"
if [ ! -d "$ENG/node_modules" ]; then
  ( cd "$ENG" && npm i --no-save --silent --no-audit --no-fund >/dev/null 2>&1 ) \
    || { echo "[beat-keeper] npm i failed — skipping beat"; exit 0; }
fi

# 3) the ONLINE beat: SAOS_ONLINE_CONTENT=1 dials the live bridge (the desk's
#    provider at 127.0.0.1:3000); the corpus floor still speaks when the bridge
#    is down. Verdicts are honest either way; exit 0 = heartbeat lived.
export SAOS_ONLINE_CONTENT=1
export SAOS_AI_BRIDGE="${SAOS_AI_BRIDGE:-http://127.0.0.1:3000}"
( cd "$ENG" && timeout 280 node ci-cycle.mjs 2>&1 | tail -2 )
RC=${PIPESTATUS[0]}

# 4) state churn commit — machine identity, FF-only push, honest skip on contention
if [ -n "$(git status --porcelain -- "$ENG/state" "$ENG/receipts" "$ENG/memory-seed" 2>/dev/null)" ]; then
  git config user.name "agent-zai[beat]"
  git config user.email "agent-zai@agents.roshpinacare-sys"
  git add -- "$ENG/state" "$ENG/receipts" "$ENG/memory-seed" 2>/dev/null
  git commit -q -m "SAOS-agent-beat: ONLINE content lane (local writers' room) [ci]" || true
  if ! git push -q origin saos-cockpit 2>/dev/null; then
    git pull --rebase -q -X theirs origin saos-cockpit 2>/dev/null \
      && git push -q origin saos-cockpit 2>/dev/null \
      && echo "[beat-keeper] push reconciled" \
      || echo "[beat-keeper] push lost the race — honest skip (cloud beat carries the state)"
  fi
fi
echo "[beat-keeper] beat done rc=$RC $(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
