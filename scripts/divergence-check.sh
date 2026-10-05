#!/usr/bin/env bash
# DIVERGENCE VISIBILITY CHECK — read-only. Closes audit break #3 (silent divergence).
# Run manually or from any monitor: reports ahead/behind vs origin/saos-cockpit.
# Exit: 0 = synced-or-ahead (FF possible) | 1 = fetch failed | 2 = behind or true divergence
set -uo pipefail
cd "$(dirname "$0")/.."
export GIT_TERMINAL_PROMPT=0
git fetch origin saos-cockpit >/dev/null 2>&1 || { echo "FETCH-FAIL (offline / credential / remote unreachable)"; exit 1; }
RT=$(git rev-parse origin/saos-cockpit)
LH=$(git rev-parse HEAD)
COUNTS=$(git rev-list --left-right --count "$RT...$LH")
BEHIND=$(echo "$COUNTS" | cut -f1)
AHEAD=$(echo "$COUNTS" | cut -f2)
echo "remote=$RT"
echo "local =$LH"
echo "behind=$BEHIND ahead=$AHEAD"
if [[ "$BEHIND" -eq 0 ]]; then
  echo "STATE: SYNCED-OR-AHEAD — FF push possible (scripts/sovereign-push.sh)"
  exit 0
elif git merge-base --is-ancestor "$LH" "$RT"; then
  echo "STATE: LOCAL-BEHIND — remote advanced; local must fetch/merge (never force others)"
  exit 2
else
  echo "STATE: TRUE-DIVERGENCE — both lineages advanced since common ancestor"
  echo "LAW: no force. Reconcile by decision (fetch + merge + worklog) or operator order."
  exit 2
fi
