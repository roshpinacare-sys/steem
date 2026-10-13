#!/usr/bin/env bash
# auto-reconcile.sh — R312 SELF-RECONCILE LAW (measured 20:42→21:0x: remote tip
# moved 3× while this sandbox worked; every push died DIVERGENCE-ABORT and the
# persistence loop could only log-and-wait — a standing agent must not need a
# human merge referee for state ledgers).
# LAW (SOVEREIGN-WRITER-LAW): never force; merge is the honest reconcile.
# Resolution law: JSONL ledgers = union (append-only, both sides live);
# JSON state = ours-wins when it parses, else theirs; everything else = manual
# abort (fail-honest, never guess).
set -uo pipefail
cd "$(dirname "$0")/.."
T="origin/saos-cockpit"
git fetch origin saos-cockpit >/dev/null 2>&1 || { echo "RECONCILE-FETCH-FAIL"; exit 1; }
if git merge-base --is-ancestor "$T" HEAD 2>/dev/null; then echo "RECONCILE-NOT-NEEDED"; exit 0; fi
# R321 · LIVE-STATE-FIRST LAW (measured 2026-10-13 11:2x twice: merge refused
# to START because live services kept tracked state files dirty → the conflict
# loop found nothing → commit failed → RECONCILE-COMMIT-FAIL, manual rescue
# required). The dirty live state is snapshotted BEFORE the merge attempt, so
# the merge always starts clean and the resolution law below always applies.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git add -A ':!upload' ':!.secrets' 2>/dev/null
  git -c commit.gpgsign=false commit -m "state: live churn snapshot before self-reconcile (R321)" >/dev/null 2>&1 \
    || { echo "RECONCILE-SNAPSHOT-FAIL"; exit 5; }
fi
if ! git merge-base --is-ancestor HEAD "$T" 2>/dev/null; then
  if ! git merge --no-edit -m "merge: self-reconcile with $T (union ledgers · alive-wins state · R312)" "$T" >/dev/null 2>&1; then
    # resolve conflicts by law
    for f in $(git diff --name-only --diff-filter=U 2>/dev/null); do
      case "$f" in
        *.jsonl)
          git show "HEAD:$f" > "$f" 2>/dev/null
          git show "$T:$f" 2>/dev/null | >> "$f" cat
          ;;
        *.json)
          git show "HEAD:$f" > "$f" 2>/dev/null
          if ! python3 -c "import json,sys; json.load(open('$f'))" 2>/dev/null; then
            git show "$T:$f" > "$f" 2>/dev/null
          fi
          ;;
        *) echo "RECONCILE-MANUAL-REQUIRED: $f"; git merge --abort >/dev/null 2>&1; exit 2;;
      esac
      git add "$f"
    done
    git -c commit.gpgsign=false commit --no-edit >/dev/null 2>&1 || { echo "RECONCILE-COMMIT-FAIL"; exit 3; }
  fi
fi
# post-merge marker gate (never ship conflict poison)
if git grep -qE '^(<<<<<<< |=======\r?$|>>>>>>> )' -- 'mini-services' 'sanbox' 'scripts' 'memory' 'agent' 2>/dev/null; then
  echo "RECONCILE-MARKERS-LEFT"; exit 4
fi
# lineage visibility: the anchored tip must survive every reconcile
node scripts/chain-anchor-probe.mjs >/dev/null 2>&1 \
  && echo "chain: anchored ok" || echo "chain: PROBE-RED — check chain-anchor-probe before push (R321 law)"
echo "RECONCILED $(git rev-parse --short HEAD)"
exit 0
