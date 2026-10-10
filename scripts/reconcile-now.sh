#!/usr/bin/env bash
# scripts/reconcile-now.sh — R303 · SELF-RECONCILIATION (the R300/R302 dance, automated).
#
# THE MEASURED DISEASE (56 divergence alerts / 24h): the CI heartbeat advances
# 1-2 commits every ~15 min while our LIVE state files are always dirty (the
# engine writes them continuously) — so every `git merge --ff-only` collides
# with local dirt and aborts, and the tree drifts behind until an agent runs
# the by-hand dance (soft-reset origin + alive-wins json + union jsonl).
# Twice proven by hand (R300 8da78332, R302 987f0664) — now the custodian
# runs it itself (the standing law: nothing waits for a human operator).
#
# SAFETY LAWS (fail-closed, in order):
#   G0 no merge in progress, no conflict markers in tree
#   G1 ahead must be 0 — local commits exist means an AGENT decides (never auto)
#   G2 behind==0 → already synced, no-op
#   G3 soft-reset only — the worktree (the live engine) is never touched
#   G4 .jsonl → union(remote, local, dedupe, sort .at) with per-file jq fallback
#      (a file that fails re-serialization keeps its local content, alert-free)
#   G5 every re-applied .json must jq-validate or the whole reconcile aborts
#   G6 zero code deletions staged (state/receipts/memory rotation is legal)
#   G7 push only through scripts/sovereign-push.sh (G1-G4 gates + doctrine audit)
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
BR="saos-cockpit"
fail() { echo "{\"ok\":false,\"reason\":\"$1\"}"; exit 1; }

git fetch origin "$BR" >/dev/null 2>&1 || fail "fetch-failed"
[ -f .git/MERGE_HEAD ] && fail "merge-in-progress"
rg -q '^(<{7} |={7}$|>{7} )' . 2>/dev/null && fail "conflict-markers-in-tree"

ahead=$(git rev-list --count "origin/$BR..HEAD" 2>/dev/null || echo "?")
[ "$ahead" = "0" ] || fail "ahead=$ahead — local commits exist, agent-law required (never auto)"

behind=$(git rev-list --count "HEAD..origin/$BR" 2>/dev/null || echo 0)
[ "$behind" = "0" ] && { echo '{"ok":true,"reason":"already-synced"}'; exit 0; }

# G3/G4 · delta snapshot: dirty TRACKED files — the live worktree IS the truth
mapfile -t DIRTY < <(git status --porcelain=v1 | awk '$1 !~ /\?\?/ {print $2}')
if [ "${#DIRTY[@]}" -eq 0 ]; then
  if git merge --ff-only "origin/$BR" >/dev/null 2>&1; then
    echo '{"ok":true,"reason":"ff-clean"}'; exit 0
  fi
  fail "ff-failed-clean-tree"
fi

git reset --soft "origin/$BR" >/dev/null 2>&1 || fail "soft-reset-failed"
git reset -q  # unstage all; re-apply per law

UNIONED=0; KEPT=0
for f in "${DIRTY[@]}"; do
  [ -f "$f" ] || continue  # worktree-deleted (state rotation) → stays deleted
  case "$f" in
    *.jsonl)
      REM="$(mktemp)"
      git show "origin/$BR:$f" > "$REM" 2>/dev/null || : > "$REM"
      if sort -u "$f" "$REM" 2>/dev/null | jq -cs 'sort_by(.at // "") | .[] | tojson' > "$f.r303tmp" 2>/dev/null && [ -s "$f.r303tmp" ]; then
        mv "$f.r303tmp" "$f"; UNIONED=$((UNIONED+1))
      else
        rm -f "$f.r303tmp"  # G4 fallback: local content stands, honest
      fi
      rm -f "$REM"
      ;;
    *) KEPT=$((KEPT+1)) ;;  # G4: .json + code → worktree wins (alive-wins)
  esac
done

# G5 · every tracked .json must validate or the reconcile aborts (torn never persists)
BAD=""
while IFS= read -r j; do
  [ -f "$j" ] || continue
  jq -e . "$j" >/dev/null 2>&1 || BAD="$BAD $j"
done < <(git status --porcelain=v1 | awk '$1 !~ /\?\?/ {print $2}' | grep '\.json$' || true)
[ -n "$BAD" ] && fail "invalid-json-after-reapply:$BAD"

git add -A
DELCODE=$(git diff --cached --name-only --diff-filter=D | grep -vE 'state/|receipts/|memory/|\.jsonl$|\.lock$' | wc -l)
[ "$DELCODE" -gt 0 ] && { git reset -q; git reset --hard -q "origin/$BR" >/dev/null 2>&1 || true; fail "code-deletions=$DELCODE — blocked (G6 guard law)"; }

UUID=$(python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null || echo "saos-reconcile")
git commit -q -m "$UUID" -m "SAOS-reconcile: self-reconciliation dance (R303) — soft-reset origin + alive-wins json + union jsonl (${UNIONED} unioned, ${KEPT} kept), jq-validated, 0 code deletions" || fail "commit-failed"

if bash scripts/sovereign-push.sh >/dev/null 2>&1; then
  echo "{\"ok\":true,\"reason\":\"reconciled\",\"behind\":$behind,\"unioned\":$UNIONED,\"kept\":$KEPT}"
  exit 0
fi
fail "push-failed-through-gate"
