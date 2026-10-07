#!/usr/bin/env bash
# SOVEREIGN RUNNER (R242) — universal dumb executor of git-truth.
# Law: docs/CHAIN-NATIVE-SOVEREIGNTY.md — the chain is the brain+clock; this script is just a leg.
# Runs on ANY always-on host (VPS / laptop / phone-termux / CI). Zero truth lives here:
#   1. zero-trust sync from git   2. chain staleness check   3. boot engine if dead   4. push state sweep via gate.
# Cron recipe (any host):  */15 * * * * /path/to/scripts/sovereign-runner.sh >> /var/log/saos-runner.log 2>&1
set -uo pipefail
cd "$(dirname "$0")/.."
BRANCH="saos-cockpit"

# --- 1. zero-trust sync (SANDBOX-DISTRUST-LAW §2.4): local = disposable
git fetch origin "$BRANCH" >/dev/null 2>&1 || echo "RUNNER-WARN: fetch failed (offline?); continuing with local copy"
if [[ -n "$(git status --porcelain mini-services/saos-engine/state 2>/dev/null)" ]]; then
  echo "RUNNER: live state present — keeping (engine owns it)"
else
  git reset --hard "origin/$BRANCH" >/dev/null 2>&1 && echo "RUNNER: synced to origin/$BRANCH = $(git rev-parse --short HEAD)"
fi

# --- 2. chain truth: how stale is the latest on-chain anchor?
ANCHOR_INFO="$(node scripts/chain-anchor-probe.mjs 2>/dev/null || echo '{}')"
ANCHORED="$(node -e "try{const j=JSON.parse(process.argv[1]);console.log(j.anchored)}catch{console.log('unknown')}" "$ANCHOR_INFO")"
echo "RUNNER: chain-anchor anchored=${ANCHORED}"

# --- 3. engine liveness: boot if dead (idempotent, safe to re-run)
if curl -s --max-time 3 http://localhost:3040/status >/dev/null 2>&1; then
  echo "RUNNER: engine alive on :3040 — no action"
else
  echo "RUNNER: engine DEAD — booting from git..."
  ( cd mini-services/saos-engine && (bun install >/dev/null 2>&1 || true) && nohup bun index.ts >/tmp/saos-engine.log 2>&1 & echo "RUNNER: engine boot requested (pid $!)" )
fi

# --- 4. full selftest gate (fail-closed evidence, cheap)
if node mini-services/saos-engine/selftest.mjs 2>/dev/null | tail -1 | rg -q "PASS"; then
  echo "RUNNER: selftest PASS"
else
  echo "RUNNER: SELFTEST-FAIL — alarm (do NOT trust this runner's state)"
  exit 2
fi

echo "RUNNER: heartbeat complete @ $(date -u +%FT%TZ)"
